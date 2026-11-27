# Polar user guide

This guide covers the Windows 11 desktop app. For Ubuntu and macOS packages and supported launchers, see the [download table](../README.md#download).

## Getting started on Windows

1. Run `Polar-1.0.0-rc.20-windows-x64-setup.exe`. The installer uses your Windows user account. If the WebView2 Runtime is missing, the installer directs you to Microsoft’s download page.
2. Open **Polar** from the Start menu. Polar shows your saved library while it scans Steam, Epic Games and PC Game Pass. Move through games with the arrow keys, the onscreen arrows, or a controller. Press Enter or the controller’s confirm button to play.
3. Open **Settings → Game library** to see how many games each launcher found and read scan details. Use **Settings → Startup** to launch Polar at Windows sign-in. Close the settings drawer with **Close**, an outside click, Esc or the controller’s back button.
4. To update, quit Polar using the button next to Settings, then run the new installer. To uninstall, use **Installed apps** in Windows Settings. Polar stores its user data separately from the installation directory and from your games and saves.

## Finding games

**Epic Games.** Polar reads Epic’s per-user installation journal (`installations.jsonl`), central installation records, and per-game `.egstore` metadata. It also checks the **Epic Games** folder on each connected local drive, including locations such as `D:\Epic Games` and `E:\Epic Games`. For another location, open **Settings → Game library → Add Epic games folder** and choose the game folder or its parent.

If a game folder has no usable launch ID, open **Library → Epic Games** and choose **Connect shortcut** on that game. Select the desktop shortcut created by the Epic Games Launcher. Disconnecting it keeps the installed game files.

**Steam and PC Game Pass.** Polar reads Steam installation records and its local app-type cache. For PC Game Pass, it checks Windows registrations against game metadata in XboxGames folders and locations specified by `.GamingRoot`. To add a game that the scan missed, open **Library → Add game**, select an existing game shortcut or registered Windows app, then confirm the name and platform.

## Playing and editing

Choose **Play** on the home screen. The button changes to **Starting…**, then **Running** when Polar detects the game. After a detected game exits, the button returns to **Play**. If a launcher or sign-in screen prevents tracking, Polar briefly shows the status and lets you try again. You can still browse, change settings, or return with Alt+Tab.

Right-click any game to edit its name, cover or background. You can also use Shift+F10, the controller’s menu button, or **…** beside Play. For manually added games, the same editor can change or remove the shortcut.

## Favorites

Open a game’s menu and choose **Add to favorites** or **Remove from favorites**. To edit several at once, open **Library → Favorites → Edit list**, select the games, then choose **Done editing**.

Favorites appear first on Home and in the library’s All and platform views. On startup, Polar selects the first installed favorite. Within each group, Home prioritizes recently played games and Library sorts by title. During bulk editing, games stay in title order so each checkbox stays in place.

## Display and artwork

Polar remembers your window mode. Its startup animation takes about a second. Click or press a key or controller button to skip it. Reduced motion in Polar or Windows skips the animation automatically. Text, tiles and controls scale together on large windows and 4K screens.

Steam games use their App ID to look up store screenshots. For Epic games with a catalog item ID, Polar looks up artwork metadata through egdata and downloads images from Epic’s CDN. To link another edition or set artwork for a manually added or PC Game Pass title, use **Game background → Find on Steam**. The search sends your chosen title to Steam in the app’s current language. You can also paste an original SteamGridDB Hero image URL in the game editor and choose **Apply image**. [SteamGridDB](https://www.steamgriddb.com/)

Polar looks for landscape screenshots of at least 1920 × 1080, then wide Steam library artwork of at least 1920 × 620. When only a cover is available, it can provide a blurred backdrop. Square game tiles crop landscape and portrait covers around their center. You can import a local JPEG, PNG or WebP cover in the editor. Library headings and filters stay in place while the games scroll. [Steam library artwork specifications](https://partner.steamgames.com/doc/store/assets/libraryassets?l=english)

Turn off **Online game artwork** to use local files and previously cached downloads. The artwork cache holds up to 128 MiB per user and evicts older files when space is needed. Restoring the default background clears the custom association for that game.

## Building and testing

- Run `cargo test --workspace --locked` for Rust tests and `node --test tests/desktop-model.mjs` for the library model.
- To exercise the UI in a browser, serve `desktop/ui` locally, set `POLAR_TEST_URL` to that URL, and run the `tests/desktop-*.cjs` scripts with Playwright. These tests supply fixture responses to native commands.
- On Windows x64, install the Rust MSVC toolchain, Visual Studio C++ Build Tools and NSIS 3, then run `.\packaging\build.ps1`. On Ubuntu x64 or an Apple Silicon Mac, run `packaging/build-unix.sh` on the target OS. Installers are written to `target/dist`. The repository also includes a separate Windows library diagnostic CLI, available with `cargo run -- list`.
- The icon source is `desktop/ui/polar.svg`. Run `uv run packaging/render-icon.py` to regenerate the native icons. Use `uv run tests/windows-icons.py <Polar.exe> <setup.exe> <Uninstall.exe>` to check the embedded Windows icons.

Native builds, installation checks and release packaging are defined in the [release workflow](../.github/workflows/release.yml). The original [product specification](PRD.md) and [development plan](PLAN.md) are available in Korean.
