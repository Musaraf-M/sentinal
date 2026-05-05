#!/usr/bin/env bash
# Publish all OpenClaw skills to ClawHub
set -euo pipefail

SKILLS_DIR="platforms/openclaw"

for skill_dir in "$SKILLS_DIR"/infrawatch-*; do
    if [ -f "$skill_dir/SKILL.md" ]; then
        slug=$(basename "$skill_dir")
        echo "Publishing $slug..."
        clawhub skill publish "$skill_dir" --slug "$slug" --tags latest
        echo "✓ $slug published"
        echo ""
    fi
done

echo "All skills published."
