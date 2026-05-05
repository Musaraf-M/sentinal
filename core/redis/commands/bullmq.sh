#!/usr/bin/env bash
# Sentinal — BullMQ Queue Inspector
# Usage: bash bullmq.sh <command> [args] [REDIS_URL]
#
# Commands:
#   list                          List all BullMQ queues with depths
#   status <queue>                Detailed status of a queue
#   failed <queue> [count]        Show failed jobs (default: 10)
#   job <queue> <jobId>           Inspect a specific job
#   stale <queue> [minutes]       Find stale active jobs (default: 10 min)

set -euo pipefail

COMMAND="${1:-help}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
CLI="redis-cli -u $REDIS_URL"

case "$COMMAND" in
    list)
        echo "BullMQ Queues:"
        echo ""
        printf "%-30s %8s %8s %8s %8s %8s\n" "QUEUE" "WAIT" "ACTIVE" "DELAYED" "FAILED" "DONE"
        echo "────────────────────────────────────────────────────────────────────────────────"

        cursor=0
        while true; do
            result=$($CLI scan $cursor match "bull:*:meta" count 100 2>/dev/null)
            cursor=$(echo "$result" | head -1 | tr -d '\r')
            keys=$(echo "$result" | tail -n +2 | tr -d '\r')

            for key in $keys; do
                if [ -n "$key" ]; then
                    q=$(echo "$key" | sed 's/^bull:\(.*\):meta$/\1/')
                    wait=$($CLI llen "bull:$q:wait" 2>/dev/null | tr -d '\r')
                    active=$($CLI llen "bull:$q:active" 2>/dev/null | tr -d '\r')
                    delayed=$($CLI zcard "bull:$q:delayed" 2>/dev/null | tr -d '\r')
                    failed=$($CLI zcard "bull:$q:failed" 2>/dev/null | tr -d '\r')
                    completed=$($CLI zcard "bull:$q:completed" 2>/dev/null | tr -d '\r')
                    printf "%-30s %8s %8s %8s %8s %8s\n" "$q" "${wait:-0}" "${active:-0}" "${delayed:-0}" "${failed:-0}" "${completed:-0}"
                fi
            done

            if [ "$cursor" = "0" ]; then break; fi
        done
        ;;

    status)
        QUEUE="${2:?Usage: bullmq.sh status <queue>}"
        echo "Queue: $QUEUE"
        echo ""
        echo -n "  Waiting:   "; $CLI llen "bull:$QUEUE:wait" 2>/dev/null
        echo -n "  Active:    "; $CLI llen "bull:$QUEUE:active" 2>/dev/null
        echo -n "  Delayed:   "; $CLI zcard "bull:$QUEUE:delayed" 2>/dev/null
        echo -n "  Failed:    "; $CLI zcard "bull:$QUEUE:failed" 2>/dev/null
        echo -n "  Completed: "; $CLI zcard "bull:$QUEUE:completed" 2>/dev/null
        echo -n "  Paused:    "; $CLI llen "bull:$QUEUE:paused" 2>/dev/null
        echo -n "  Repeat:    "; $CLI zcard "bull:$QUEUE:repeat" 2>/dev/null
        echo ""

        # Check for event stream consumers
        echo "  Workers:"
        $CLI xinfo groups "bull:$QUEUE:events" 2>/dev/null | sed 's/^/    /' || echo "    No event stream found"
        ;;

    failed)
        QUEUE="${2:?Usage: bullmq.sh failed <queue> [count]}"
        COUNT="${3:-10}"
        echo "Failed jobs in '$QUEUE' (last $COUNT):"
        echo ""

        job_ids=$($CLI zrange "bull:$QUEUE:failed" "-$COUNT" -1 2>/dev/null | tr -d '\r')
        for job_id in $job_ids; do
            if [ -n "$job_id" ]; then
                echo "  Job: $job_id"
                name=$($CLI hget "bull:$QUEUE:$job_id" name 2>/dev/null | tr -d '\r')
                reason=$($CLI hget "bull:$QUEUE:$job_id" failedReason 2>/dev/null | tr -d '\r')
                attempts=$($CLI hget "bull:$QUEUE:$job_id" attemptsMade 2>/dev/null | tr -d '\r')
                echo "    Name:     ${name:-unknown}"
                echo "    Reason:   ${reason:-unknown}"
                echo "    Attempts: ${attempts:-0}"
                echo ""
            fi
        done
        ;;

    job)
        QUEUE="${2:?Usage: bullmq.sh job <queue> <jobId>}"
        JOB_ID="${3:?Usage: bullmq.sh job <queue> <jobId>}"
        echo "Job Details: $QUEUE / $JOB_ID"
        echo ""
        $CLI hgetall "bull:$QUEUE:$JOB_ID" 2>/dev/null | while IFS= read -r key; do
            read -r value
            printf "  %-15s %s\n" "$key:" "$value"
        done
        ;;

    stale)
        QUEUE="${2:?Usage: bullmq.sh stale <queue> [minutes]}"
        MINUTES="${3:-10}"
        THRESHOLD=$(( $(date +%s) * 1000 - MINUTES * 60 * 1000 ))
        echo "Stale active jobs in '$QUEUE' (active > ${MINUTES}m):"
        echo ""

        active_jobs=$($CLI lrange "bull:$QUEUE:active" 0 -1 2>/dev/null | tr -d '\r')
        found=false
        for job_id in $active_jobs; do
            if [ -n "$job_id" ]; then
                processed=$($CLI hget "bull:$QUEUE:$job_id" processedOn 2>/dev/null | tr -d '\r')
                if [ -n "$processed" ] && [ "$processed" -lt "$THRESHOLD" ] 2>/dev/null; then
                    name=$($CLI hget "bull:$QUEUE:$job_id" name 2>/dev/null | tr -d '\r')
                    echo "  ⚠ Job $job_id ($name) — active since $(date -r $((processed / 1000)) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo $processed)"
                    found=true
                fi
            fi
        done

        if [ "$found" = false ]; then
            echo "  ✓ No stale jobs found"
        fi
        ;;

    help|*)
        echo "Sentinal BullMQ Inspector"
        echo ""
        echo "Usage: bullmq.sh <command> [args]"
        echo ""
        echo "Commands:"
        echo "  list                          List all queues with depths"
        echo "  status <queue>                Detailed queue status"
        echo "  failed <queue> [count]        Show failed jobs (default: 10)"
        echo "  job <queue> <jobId>           Inspect a specific job"
        echo "  stale <queue> [minutes]       Find stale active jobs (default: 10m)"
        echo ""
        echo "Environment:"
        echo "  REDIS_URL    Redis connection URL (default: redis://localhost:6379)"
        ;;
esac
