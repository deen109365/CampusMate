# CampusMate

CampusMate is a study-partner matching app for university students. Students enter their module and when they are free, and the app finds others to study with. It is a progressive web app (PWA), so it installs on a phone, and it opens offline with previously loaded data.

Built for the Mobile Web Development module (MAB001 / CS32005), University of Dundee.

Live App: https://deen109365.github.io/CampusMate/

GitHub Repository: https://github.com/deen109365/CampusMate

Unit Tests: https://deen109365.github.io/CampusMate/tests.html

## Features

1. Sign up and log in with email verification (Firebase Authentication)
2. Profile with module, availability, study goal and an optional photo (cropped and resized)
3. Matches ranked by shared days and times and by the same study goal
4. Study requests: chat only unlocks after the other student accepts
5. Live chat with unread badges, alerts and a "Seen" label
6. Study sessions with a date, time and place, reminders, calendar export and ratings
7. Suggest a spot: weather-based indoor or outdoor suggestion (Open-Meteo and device location, used once and not stored)
8. Study places map: libraries, cafes and parks within 1.5 km (Leaflet, OpenStreetMap, Nominatim, with Overpass as a fallback)
9. Study groups of up to five people, with unread badges, Add member (creator only, accepted partners only) and Leave group
10. Block, report and hide-profile options
11. Dark theme, accessibility features, and an offline banner with cached data available
12. Optional device (Face ID) lock

## How to use

1. Open the live link in a browser, or on a phone choose "Add to Home Screen" to install it.
2. Create an account and verify your email.
3. Fill in your profile (module, availability, study goal).
4. Open Home to see matches and send a request.
5. After the request is accepted, chat, plan a session, or use Suggest a spot and the map.

## Run locally

The app is plain HTML, CSS and JavaScript with no build step.
1. Download or clone the repository.
2. Start a local web server in the folder, for example `python3 -m http.server 8000`, and open `http://localhost:8000` in a browser.
3. The app uses my Firebase project, so it works as it is.

## Testing

1. Unit tests: open tests.html in a browser. It runs 132 tests and shows 132 / 132 passed.
2. Manual testing: every feature tested with three accounts (three different emails) on a laptop and an iPhone.
3. Lighthouse: performance 100, accessibility 98, best practices 100, SEO 100.
4. Log and screenshots: the full test log is CampusMate Testing and Debugging Log.pdf in the repository root, and the screenshots are in the testing folder.

## Repository contents

1. README.md: project overview, how to use it and how to run it
2. index.html and style.css: page structure and styling
3. app.js: main app logic, Firebase and screens
4. matching.js: match ranking
5. sessions.js: study sessions, ratings and unread counts
6. groups.js: group rules
7. places.js: map places and search
8. ui.js: shared interface helpers
9. service-worker.js and manifest.json: offline support and installation
10. icon-192.png and icon-512.png: app icons
11. firestore.rules: database security rules
12. tests.html: unit tests
13. CampusMate Testing and Debugging Log.pdf: test and debug log
14. testing folder: test screenshots
15. Design Proposal.pdf: project's initial design proposal
16. LICENSE: MIT licence

## Security and privacy

1. Firestore security rules control who can read and write each document, so users cannot bypass the app.
2. Only essential data is collected. Location is used once and never stored.
3. Users can hide their profile, block and report others.

## Known limitations

1. Login, new messages, the map and the weather suggestion need an internet connection.
2. No push notifications when the app is closed (this needs Cloud Functions on a paid plan).
3. Groups have chat, alerts and membership only, with no group sessions or map.
4. Tested on Chrome (Windows) and Safari (iPhone). The app uses standard web features, so it should work on other devices and browsers too.

## Credits

1. Firebase for authentication and database
2. Leaflet and OpenStreetMap contributors for the map
3. Nominatim and Overpass API for place data
4. Open-Meteo for weather
5. AI assistants (Claude and ChatGPT) were used to help write and debug code, tests and documents, as declared in the project report.
