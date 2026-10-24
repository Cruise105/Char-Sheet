# Character Sheets

Customizable D&D 5e (2014) character sheets for your table. Runs in Chrome, installs to the home screen, works offline, and syncs through Google Drive. Includes the full sheet, Inventory Tracker, automatic math, the Look options (21 palettes, 18 heading fonts, 18 text fonts, 18 frames), red light, Drive sharing, and the Library with auto-fill.

## Put it online (about 10 minutes, same as the Bestiary)

1. On GitHub, click **+** → **New repository**. Name it `charsheet`, set it to **Public**, tick **Add a README file**, and click **Create repository**.
2. Unzip `charsheet.zip` on your PC.
3. In the new repository, click **Add file** → **Upload files**. Drag in **everything** from inside the unzipped folder, including the `js`, `fonts` and `icons` folders. Click **Commit changes**.
4. Repository **Settings** → **Pages** → Branch **main**, **/ (root)** → **Save**.
5. A minute later it's live at `https://cruise105.github.io/charsheet/`.

## One-time Google setup (about 10 minutes)

This uses the same Google Cloud project and sign-in key as your Bestiary and Session Notes. Three additions:

1. **Turn on the file picker.** In Google Cloud Console, open your project → **APIs & Services** → **Library**. Search for **Google Picker API** and click **Enable**.
2. **Make an API key for the picker.** **APIs & Services** → **Credentials** → **Create credentials** → **API key**. Then click the new key to restrict it:
   - Application restrictions: **Websites**, and add `https://cruise105.github.io/*`
   - API restrictions: **Restrict key** → tick **Google Picker API**
   - Save, then copy the key.
   Open `js/config.js`, paste the key between the quotes on the `PICKER_API_KEY` line, and upload that one file to the repository again.
3. **Add your wife as a test user.** **Google Auth Platform** (or **OAuth consent screen**) → **Audience** → **Test users** → **Add users** → her Gmail address. Do the same for each player later.

When anyone signs in the first time, Google shows "Google hasn't verified this app." That's expected for a personal app in testing. Tap **Continue**.

## Your device (the DM)

1. Open the app → **Settings** (gear) → **Who's using this device: Dungeon Master**.
2. **Connect Google Drive**. The app makes a folder in your Drive called **Character Sheets**.
3. Make a character (or have a player make theirs first, see below), then on its card tap **Share with player** and enter their Gmail. They get edit access to that one sheet only.

Every sheet in the folder shows up on your device, and you can open and edit any of them.

## Your wife's tablet (a player)

1. Open `https://cruise105.github.io/charsheet/` in Chrome → **⋮** → **Add to home screen** → **Install**.
2. **Settings** → **Player** → **Connect Google Drive**.

Then one of these:

- **You already shared her character:** in Settings tap **Open shared files** and pick both her sheet and the Table Library (tap each one, then **Select**).
- **She made her character on her tablet first:** you make a character with just her character's name and share it with her. On her tablet she taps **Link to Drive** on her character card, picks that sheet and the Table Library, and chooses **This device's** version. From then on the two copies are one.

## The Library

Tap **Library** on the character list. It has every SRD 5.1 race, class, subclass, background, feat and language built in. On your device (DM role) you can:

- **Add your own entries**: New race, class, subclass, background, feat or language. Type the text word for word from the book. A subrace is a race with "Subrace of" set; a subclass is linked to its class.
- **Give each background its feat**: pick it under **Assigned feat** (add the feat first).
- **Add a Table Rules note** to any entry, including SRD ones (Edit → Table Rules note). It shows in its own box under the official text, on the sheet too. **Restore SRD version** removes your edits.

On a sheet, type or pick a race, class, subclass or background from the suggestions. The sheet fills in traits, features up to the character's level, speed, vision, ability increases, proficiencies, saving throws, languages, the background feature and its feat. Raising the level adds that level's features. Changing the race swaps the old race's traits for the new one's. Anything typed by hand stays put. The small **i** button opens the full entry.

The library lives in your Drive folder as "Table Library", and sharing a sheet with a player shares the library with them too (read-only). Players open both at once from **Open shared files**.

## Spells, Level Up and rests

- **Spells page:** each class and subclass list, sorted by level. Tap ★ to mark spells known or prepared; subclass spells (domain, oath) are marked **Always**. Tap a name to read it, **Cast** to spend points or a slot. "Spells from other lists" covers racial spells, feats and Magical Secrets.
- **Spell points (Table Rules):** DMG costs and pool. The first 3 casts each of 5th and 6th level per long rest need no save; after that, and on every 7th to 9th level cast, the app asks for the strain save (DC 10 + spell level) and adds exhaustion on a failure. Warlocks keep their Pact Magic slots either way.
- **Level up:** under the character name. Roll the hit die or take the average; a roll below the average counts as the average. At Ability Score Improvement levels it asks for scores or a feat, and at the subclass level it asks for the subclass. New features fill in.
- **Short rest** spends hit dice one at a time (roll at the table, type it in). **Long rest** restores everything.
- **Table Rules switches** (DM, in Settings): spell points or slots, and Active or standard initiative. Players get the change with the Table Library. In Active Initiative the Initiative box becomes the Interrupt Point; taking HP damage recharges a spent one.

## How syncing works

- Each device saves instantly to itself, then syncs with Drive a few seconds after changes and checks for others' changes about every 30 seconds.
- If you and a player change different parts of the sheet at the same time, both changes are kept. If you both change the same field, the later edit wins. A list (one inventory section, the attacks) counts as one field.
- The sync dot on the top bar: green synced, yellow syncing, gray signed out or offline, red a problem (tap it to see what).

## Updating the app later

Upload the new files to the same repository (all of them, every time, so nothing new is missed). On the PC, press Ctrl+Shift+R once. Installed tablets update the next time they open while online.

## Credits

Includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Fonts: all under the SIL Open Font License (see the LICENSE files in the fonts folder). Fonts nobody has picked yet download the first time they're chosen, then work offline.
