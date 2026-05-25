# Plane Sound Radar

Plane Sound Radar is a browser-based aircraft noise/range awareness prototype. It shows nearby aircraft relative to human hearing range and selected professional microphone ranges.

## Current Features

- Radar display for nearby aircraft
- Human hearing range status when no mic is selected
- Selectable verified professional microphone presets
- Manual mic add/edit/delete workflow
- Custom edited mic copies preserve original built-in mic records
- Delayed CONNECTION LOST status so short feed hiccups do not flash false warnings
- Local browser state for settings and mic choices

## Development Commands

Use npm.cmd in PowerShell. Do not use plain npm if PowerShell blocks npm.ps1.

Install dependencies:

    npm.cmd install

Check JavaScript syntax:

    npm.cmd run check

Format project files:

    npm.cmd run format

Check formatting without changing files:

    npm.cmd run format:check

Run the local development server:

    npm.cmd run serve

Then open:

    http://127.0.0.1:5173

Use Ctrl + Shift + R in the browser after changes to force a hard refresh.

## Normal Pre-Commit Check

Run these before committing:

    npm.cmd run check
    npm.cmd run format:check

## Repository

GitHub Pages app:

    https://williamfranks150.github.io/plane-sound-radar/
