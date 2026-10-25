# wait-rest

A Claude Code plugin you start by hand. When a plan limit (5-hour or weekly window) reaches 95%, it stops Claude's work, sleeps until the limit resets plus a 5-minute safety margin, then wakes the session and tells Claude to continue the task it was on.

Nothing happens unless you run `/wait-rest` in the session. The plugin does not run in the background on its own.

## Install

Requires Claude Code and Node.js.

```
/plugin marketplace add GIAMAT13/wait-rest
/plugin install wait-rest@wait-rest
```

Or point `marketplace add` at a local clone of this repository.

## Use

| Command | What it does |
| --- | --- |
| `/wait-rest` | Turns the watch on for this session. Reads the limits now and then every minute. |
| `/wait-rest status` | Shows whether the watch is on, whether work is paused, and the current limit readings. |
| `/wait-rest off` | Turns the watch off and cancels any pending wake-up. |

## How it works

- The limits come from `$.session.usage()`, the same readings the status line uses (`five_hour`, `seven_day`, and `spend_limit` on gateways). Readings update when the model answers, so the plugin also re-checks on each `session.measure` event.
- At 95% or more of a window whose reset is still ahead, the plugin aborts the running turn and denies tool calls. The model stays idle.
- It waits until the latest reset among the windows at the limit, plus 5 minutes. The wait is a plugin timer (`$.clock.after`), so it needs no polling.
- At wake-up it reads the limits again. If a window is still at the limit, it waits again. Otherwise it submits a message to the session: the limit has reset, continue the task. If a turn is already running, the message goes into that turn.

The constants are at the top of `hooks/register.ts`: `LIMIT_PERCENT` (95), `SAFETY_MS` (5 minutes), and `POLL_MS` (60 seconds).

## Limits of this approach

- The wake-up happens only while the Claude Code session is still running. If you close it, nothing wakes.
- Reloading the plugin cancels a pending wake-up. Start `/wait-rest` again afterwards.
- A reading is only as fresh as the last model response. An idle session may not see a limit change until its next response.

## Layout

- `.claude-plugin/plugin.json`: the plugin manifest
- `.claude-plugin/marketplace.json`: the marketplace entry for this repository
- `hooks/hooks.json`: points to the hooks module
- `hooks/register.ts`: the watch, the pause, and the wake-up

## Author

GIAMAT13

## License

MIT, see [LICENSE](LICENSE).
