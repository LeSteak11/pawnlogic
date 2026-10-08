# Chess Lab Sync — Web Store submission materials

Upload `dist/ChessLab-Sync-<version>.zip` at https://chrome.google.com/webstore/devconsole and choose **Unlisted** visibility. The publisher must sign in and complete any developer registration requirements. Publication still requires Google's review.

## Short description

Sync supported chess game pages with Chess Lab on your PC. Read-only, local-only board and clock synchronization.

## Listing description

Chess Lab Sync connects supported chess game pages to the Chess Lab desktop application on your Windows PC.

Supported pages: Chess.com computer-game pages, `/play/online`, `/game/`, and `/game/*` (including numbered live-game URLs), plus Lichess games against Stockfish.

The extension reads the displayed board, orientation, opponent name and clocks, then sends a snapshot to Chess Lab on the same computer. It follows the game tab you use and supports Chess Lab's Reconnect control. It never clicks, types, or makes a move on the chess website.

Requires the separate Chess Lab desktop application, listening on http://127.0.0.1:8765. Open Chess Lab, enable Auto-sync, and open a supported computer game. This extension does not provide a chess engine by itself. Engine recommendations are intended for computer-opponent practice; do not use engine help against human opponents.

Game information stays on your computer. No cloud account, analytics, ads, or remote executable code.

## Single purpose

Read-only synchronization of chess boards on supported pages with the user's locally running Chess Lab desktop application.

## Permission justifications

- `scripting`: reattach the packaged page reader to an already-open supported game after an extension update or a user reconnect request.
- `alarms`: poll the local application for a reconnect request when no page reader is reporting.
- `storage`: persist the last handled reconnect-generation number across service-worker restarts.
- `http://127.0.0.1:8765/*`: transmit board snapshots to the locally running desktop application and read its reconnect signal.
- Enabled Chess.com game URLs: read the displayed board, orientation, opponent name and clocks. Online boards are included; Chess.com opponent type is not filtered.
- `https://lichess.org/*`: Lichess game URLs do not encode whether the opponent is a computer; the reader verifies the Stockfish opponent label before transmitting.

## Privacy fields and review instructions

Disclose the displayed opponent name under personally identifiable information and supported game-page content under website content. Explain that information is processed only by the local desktop application; do not claim that no information is read or transmitted.

Remote code: **No**. The local endpoint returns JSON snapshots and reconnect numbers, not executable code. All extension JavaScript is included in the ZIP.

Privacy policy: publish `docs/extension-privacy.md` on an accessible HTTPS page owned by the publisher, then provide its URL. The policy's GitHub issue link is already supplied; confirm it is reachable for the repository's visibility before submission.

Screenshots: supply a real 1280×800 or 640×400 image showing the desktop application's synced status alongside a supported computer game. Do not include login details, chats or human-opponent engine assistance. Extension icons at 16, 32, 48 and 128 pixels are in the ZIP.

For reviewers, provide a download link to the desktop installer. Install it, open Chess Lab, and start a computer game on Chess.com or a Stockfish game on Lichess. Verify the synced status and board changes. The read-only extension can be inspected independently; the desktop application is required for visible results.

## Future extension releases

Build with a higher numeric version than the currently published manifest version, upload the new ZIP to the same store item, and submit it for review. Keep the store item identity stable. Retain the unpacked extension for development testing; store-installed copies use the browser's update mechanism.
