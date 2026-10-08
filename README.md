# Fridge Chef 🍳

A progressive web app (PWA) that turns the ingredients you have into budget-friendly recipes you can cook right now. Built for students living on their own.

- Type your ingredients, or take/upload a photo and let the AI spot them
- Set a budget for extras, your equipment, and servings
- Get 3 recipe ideas with a dish photo, full ingredient list (with pampalasa and amounts), steps, time, and rough cost
- Mark your pantry staples (salt, oil, soy sauce...) so the app never tells you to buy them
- Dietary filters (No pork, Halal, Vegetarian, ...) that the AI must follow and the app double-checks
- Swap one recipe, or tap "Not for me" to hide a dish, without redoing the search
- Cook mode: full-screen big text, one step at a time, with timers
- Shopping list across recipes with a rough peso total
- Save favorites (they work offline)
- Install it on your phone's home screen

## How it works

```
Phone (React PWA)  ──►  /api/recipes (serverless function)  ──►  Gemini (free) or Claude
                              ▲ your API key lives here, never in the app
```

| File | What it does |
| --- | --- |
| `src/App.jsx` | The whole screen: ingredient input, options, recipe cards, saved tab |
| `src/styles.css` | Look and feel |
| `api/recipes.js` | Server function. Builds the prompt, calls the AI, returns clean JSON |
| `api/ingredients.js` | Server function. Reads a photo and returns the ingredients the AI can see |
| `api/_rules.js` | Pantry name matching (English + Filipino names) and the diet safety check |
| `src/food.js` | Pantry/shopping helpers shared with the screens |
| `src/CookMode.jsx` | Full-screen cook mode with timers |
| `src/Shopping.jsx` | The shopping list tab |
| `vercel.json` | Gives the AI function up to 30 seconds on Vercel |
| `api/_lib.js` | Shared code for choosing and calling the AI (Gemini or Claude) |
| `vite.config.js` | Build setup + PWA settings (name, colors, icons) + local dev API |
| `public/` | App icons |

## 1. Get a free API key (Google Gemini)

1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key** and copy it.

Notes about the free tier:
- It has rate limits (a number of requests per minute and per day). You can see your exact limits in Google AI Studio. Normal personal use, like cooking a few times a day, fits comfortably.
- Google says content sent on the free tier may be used to improve their products. Ingredient lists are harmless, but don't type personal information into the app.
- Google requires users to be 18 or older.
- Free-tier terms can change, so check https://ai.google.dev/gemini-api/docs/pricing if something stops working.

## 2. Run it on your computer

You need Node.js 18 or newer.

```bash
npm install
cp .env.example .env      # then open .env and paste your key after GEMINI_API_KEY=
npm run dev
```

Open the link it prints (usually http://localhost:5173).

## 3. Put it online (free)

1. Push this folder to a new GitHub repository.
2. Go to https://vercel.com, sign in with GitHub, and choose **Add New → Project**, then pick your repo.
3. Before deploying, open **Environment Variables** and add:
   - `GEMINI_API_KEY` = your key
4. Click **Deploy**. Vercel gives you a link like `https://fridge-chef-yourname.vercel.app`.

Open that link on your phone:
- **Android (Chrome):** menu → *Install app* / *Add to Home screen*
- **iPhone (Safari):** Share → *Add to Home Screen*

## Switching to Claude later (optional)

If you ever get a Claude API key (it needs prepaid credits), add `ANTHROPIC_API_KEY` to your `.env` or Vercel settings. If both keys exist, set `AI_PROVIDER=claude` to use Claude, or `AI_PROVIDER=gemini` to stay on the free one.

## About the dish photos

Each recipe shows a real photo of the dish, taken from Wikimedia Commons (the free photo library behind Wikipedia, no key needed). The AI suggests a specific dish name for each recipe (like "pork adobo"), and the app searches photo file names for it, picks the best match, and credits the photographer with a link in the recipe pop-up. If it can't find a good match, a plate icon is shown instead of a wrong photo, and you can tap "Wrong photo? Hide it" on any photo.

The app is strict about matches: a photo is used only when its file name closely matches the dish name (all the words, with at most one or two extra). Otherwise you see a plate icon. In any recipe pop-up you can tap **Add my photo** to use your own picture of the dish. It is shrunk and saved on that device only.

Photos are uploaded by volunteers, so they won't always match your exact dish. If you ever want a unique, AI-generated picture for every recipe, Google's image models do that, but they have no free tier on the Gemini API (roughly 3 to 7 US cents per image at the time of writing). That would be a future upgrade.

Google Images can't be used for this: Google's image search API is closed to new users, and copying images from Google results isn't allowed.

## Notes on the new features

- **Diet filters** are given to the AI as strict rules, and the server also scans every recipe for forbidden words (pork, lard, fish sauce for vegetarian, and so on). Recipes that fail are thrown away and re-requested. This is a safety net, not a guarantee: anyone with a real allergy should still read labels.
- **Pampalasa:** the prompt requires every seasoning to be listed with an amount and added in a specific step, ending with a "tikman" taste check. Recipes without any seasonings are rejected and re-requested.
- **Prices** are the AI's rough guesses and the shopping total is only an estimate.
- **Cook mode timers** are picked up from the step text (like "simmer 10 to 15 minutes"). The screen is kept awake where the browser allows it, and the timer beeps and vibrates at zero. Sound only works after you tap Start on a timer.
- Your pantry, diet, hidden dishes and shopping list are saved in the browser on that device only.

## Settings you can change

- **Model:** `GEMINI_MODEL` (default `gemini-3.5-flash-lite`) or `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).
- **Colors and app name:** `vite.config.js` (manifest) and the top of `src/styles.css`.
- **Quick-add ingredients, budgets, equipment:** the lists at the top of `src/App.jsx`.
- **How the AI behaves:** the `SYSTEM_PROMPT` text in `api/recipes.js`. This is the best place to experiment.

## Roadmap (next steps for your project)

1. ✅ Text input → recipes
2. ✅ Budget, equipment, and servings filters
3. ✅ Save favorites, installable PWA, offline for saved recipes
4. ✅ Photo mode: take or upload a photo and the AI lists the ingredients
5. ✅ Pantry staples, diet filters, swap a recipe, cook mode, shopping list
6. ⬜ "Cooked this week" history
7. ⬜ Accounts and sync with Supabase

## Troubleshooting

- **"No AI key found"**: your `.env` file is missing or the key isn't set in Vercel. Restart `npm run dev` after editing `.env`.
- **"The API key was rejected"** or **"rejected the request"**: the key is wrong or was copied with extra spaces.
- **"Too many requests right now"**: you hit the free rate limit. Wait a minute (or until tomorrow if it was the daily limit).
- **A recipe shows a plate icon instead of a photo:** no good Commons match was found for that dish, or you're offline. This is expected for unusual dishes.
- **Photo scan says "too large" or fails:** try a closer, clearer photo. The app shrinks photos automatically before sending.
- **Camera button opens a file picker on a computer:** that's normal. On a phone it opens the camera.
- **Changes don't show on the installed app**: close the app fully and reopen it so the new version loads.
