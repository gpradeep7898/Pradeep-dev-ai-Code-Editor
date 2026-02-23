#!/bin/bash
# One-click browser launcher for MyIDE
cd "$(dirname "$0")"
echo "✦ Starting MyIDE..."
npm start &
sleep 2
open http://localhost:3000
wait
