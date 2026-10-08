# Chess Lab Sync privacy policy

Chess Lab Sync reads chess positions from the Chess.com pages enabled in its manifest and Lichess games against Stockfish. Its sole purpose is to synchronize these games with the Chess Lab application running on the same computer.

The extension reads piece positions, board orientation, displayed opponent name, and chess clocks. It sends this information, together with a browser tab identifier used to distinguish simultaneous games, only to `http://127.0.0.1:8765` on your own computer. It does not send this information to the developer, an analytics provider, or a remote server. Chess Lab can save games and opponent names locally in its database.

The extension stores a reconnect-generation number in the browser's extension storage. It does not read passwords, payment information, browsing history outside supported game pages, or account authentication tokens. It does not click, type, or play moves on the chess website. It does not contain analytics, advertising, or remotely downloaded executable code.

The enabled Chess.com pages include `/play/computer*`, `/game/computer/*`, `/play/online`, `/game/`, and `/game/*` (including numbered live-game URLs). Chess.com online boards are read when they appear on an enabled page; the extension does not verify that the Chess.com opponent is a computer. On Lichess, the reader checks for an opponent labeled “Stockfish level” before sending board data. Browser permissions for the Lichess domain cover its game URLs, which do not distinguish computer and human games in the URL itself.

Information is used only for the stated synchronization purpose. It is not sold or shared for advertising, creditworthiness, lending, or other unrelated purposes. Use of user data complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.

You can stop collection by disabling or uninstalling the extension. To delete locally saved games, use Chess Lab's History controls. Uninstalling the extension does not delete games stored by the separate desktop application.

Questions and privacy requests: https://github.com/LeSteak11/pawnlogic/issues
