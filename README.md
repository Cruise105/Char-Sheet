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

Every character on your device goes into the folder on its own, shared with a player or not, so all your devices see all of them. Deleting a character on your device moves its Drive copy to your Drive's trash (restorable there for 30 days).

## Dungeon Master mode is tied to your Google account

DM mode only turns on when the device is signed in to your Google account. On anyone else's device the Dungeon Master option is hidden, and the sheet stays in Player mode with the Library-based fields locked. Your address is stored only as a scrambled fingerprint in `js/dm.js`.

**Changing the DM account:** ask Claude for a new fingerprint for the new address, or make one yourself (any "SHA-256 generator" site, the address in all lowercase) and paste it into `js/dm.js`.

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

## Class options (Invocations, Metamagic, Infusions…)

- **On the sheet:** the Class options section lists each group the character has (for example "Eldritch Invocations 2 of 3"). Tap **Choose** to read the options and pick one. Options the character can't take yet show why (level or another option needed). Players can pick and remove their own; the header reminds them when picks are waiting, and Level Up says when a new one opens.
- **In the Library (DM):** each option is its own entry under **Class options**: its group, which classes or subclasses it belongs to, any level or option it needs, and its text. On the class or subclass, **Class option choices** sets how many picks it gives: `2: 2, 5: 3` means 2 from level 2 and 3 from level 5. A subclass's count adds to its class's.
- **Built in from the SRD:** Fighting Styles, Metamagic, Eldritch Invocations, Pact Boons, Hunter's choices, Dragon Ancestor and Circle of the Land terrain. Anything else (Artificer Infusions, Battle Master Maneuvers, and so on) you add as Class options, then set the counts on that class or subclass.

## Class tables

- **In the Library (DM):** each class has its book table under **Class table** in the editor. Add, rename, remove (×) and move (‹ ›) columns, and type any value in a cell ("3d6", "+2", "Unlimited", "—"). A blank cell keeps the value from the level above, shown faintly. Level, Proficiency Bonus and Features fill in on their own. A subclass can have its own columns too.
- **On the sheet:** columns marked **On sheet** show their current value at the top of Class features (for example "Sneak Attack 3d6"), one line per class when multiclassed. They update on level up.
- **In text:** write `{Sneak Attack}` (any column name in braces) in a feature's text or reminder, and the sheet shows that character's value.
- **Built in from the SRD:** Rages and Rage Damage, Martial Arts, Ki Points, Unarmored Movement, Sneak Attack, Sorcery Points, Invocations Known, plus cantrips, spells known and spell slots for the casters (those are left off the sheet).

## Notes page

The **Notes** tab on each sheet has a typed notes box and handwritten pages (finger or stylus). It syncs with the rest of the sheet.

## Linked apps (Stage 4)

Your device (DM role) ties your apps together whenever the Character Sheets app syncs:

- **Magic item app:** each character's items show on their sheet with full text and attunement, without the value, and count toward carried weight. Their attunement limit comes from there too. Turn on Google Drive sync in the magic item app.
- **Session Notes:** Favor of Fate, deaths, survival stages, and diseases you've tapped **Reveal on their sheet** for (incubating diseases stay hidden until you do). Session Notes also takes each linked character's Max HP, AC and Passive Perception from their sheet.
- **Boons:** add them in the Library under Boons, given to the whole party or chosen characters. Temp HP at dawn is applied when the Session Notes clock passes dawn, and never stacks.
- **Bestiary combat tracker:** linked players' HP, AC and Interrupt Points come from their sheets during combat, checked every few seconds, and damage or healing you enter goes onto their sheet. In Active Initiative, starting combat readies everyone's Interrupt Point, a new round readies recharging ones, and ending combat resets them.

Characters are matched by name. To fix a match, use **Settings → Linked apps** here, and the **Character sheet** box in the Bestiary's Party list.

The first time after this update, your device, the Bestiary and Session Notes ask you to sign in to Google once more, because they now read each other's files.

## How syncing works

- Each device saves instantly to itself, then syncs with Drive a few seconds after changes, and checks for others' changes every 5 seconds while the app is open (10 on the DM's device).
- HP is saved as a list of changes, so damage you enter in the Bestiary and healing a player taps at the same moment both count.
- If you and a player change different parts of the sheet at the same time, both changes are kept. If you both change the same field, the later edit wins. A list (one inventory section, the attacks) counts as one field.
- The sync dot on the top bar: green synced, yellow syncing, gray signed out or offline, red a problem (tap it to see what).

## Updating the app later

Upload the new files to the same repository (all of them, every time, so nothing new is missed). GitHub's uploader takes at most 100 files at once, so upload the `fonts` folder on its own, then everything else. On the PC, press Ctrl+Shift+R once. Installed tablets update the next time they open while online.

## Credits

Includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Fonts: all under the SIL Open Font License (see the LICENSE files in the fonts folder). Fonts nobody has picked yet download the first time they're chosen, then work offline.
