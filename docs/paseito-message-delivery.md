# Paseito message delivery

When an agent is already working, Paseito separates two different intents:

- **Queue** stores a follow-up locally and sends it in order after the active run becomes idle.
- **Steer** sends guidance immediately to the active run.

Queue is the default. The default action can be changed under **Settings → General → Default send**;
the alternate keyboard action remains available for the other choice. Each queued message also has a
visible **Steer** button.

Queues are persisted by host and agent, so they survive app restarts and temporary disconnections.
Editing removes a message from the queue and returns its text and user attachments to the composer.
If steering a selected queued message fails, Paseito restores it to its original position.

Codex app-server uses `turn/steer` against the accepted active turn. Claude sends a priority-next user
message through the existing SDK input stream. Providers without native steering restart the active
turn with the selected message; the queue-row tooltip reports this fallback. Requests from older
clients that do not explicitly request steering keep the historical replacement behavior.
