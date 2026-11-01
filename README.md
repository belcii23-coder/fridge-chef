# Fridge Chef

A progressive web app (PWA) that turns the ingredients you already have into budget-friendly recipes you can cook right now. Built for students living on their own who have no idea what to cook.

Live app: https://fridge-chef-red.vercel.app

## What it does

- **Add ingredients** by typing them, tapping the quick-add chips (the ones you use most move to the front), or taking or uploading up to 4 photos of your fridge. The AI reads the photos and lists the ingredients it can see.
- **Set your limits**: budget for extras (in pesos), the equipment you have (full kitchen, one pot, rice cooker, microwave) and how many servings.
- **Get 3 recipe ideas** with a dish photo, time, difficulty, what you will use, what you still need to buy and a rough cost.
- **Not feeling them?** Tap **New ideas** to get 3 different dishes. The app remembers what it already suggested so you do not get the same ones again.
- **Dish photos**: each dish tries to show a photo from Wikipedia, with credit. If no good match is found, you can add your own photo of the dish. Your photos are saved on your device only.
- **Cook mode**: a full-screen, one-step-at-a-time guide with an ingredient checklist. Times written in a step (like "simmer 10 minutes") become a countdown timer with +/- buttons. The timer beeps and vibrates at zero, and the screen stays awake where the browser allows it. You can cook several dishes at once and switch between them.
- **Save favorites** with the heart button. Saved recipes work offline.
- **Install it** on your phone's home screen like a normal app.
- **Responsive layout**: one column on phones, and on wide screens the ingredients and options sit on the left while the suggested dishes scroll on the right.

## How it works

```
Phone or laptop (React PWA)
        |
        |  /api/recipes   /api/scan
        v
Vercel serverless functions  -->  Google Gemini (free tier) or Claude
        ^
        your API key lives here, never in the app
```

| File | What it does |
| --- | --- |
| `src/App.jsx` | The whole screen: ingredients, options, recipe cards, dish photos, saved tab and cook mode |
| `src/styles.css` | Look and feel (Warm Market theme) |
| `api/recipes.js` | Server function. Builds the prompt, asks the AI for 3 recipes and returns clean JSON. Accepts a list of dishes to avoid for **New ideas** |
| `api/scan.js` | Server function. Reads up to 4 photos and returns the ingredients the AI can see |
| `api/_ai.js` | Shared code for choosing and calling the AI (Gemini or Claude). Not a route |
| `vercel.json` | Gives the AI functions up to 60 seconds on Vercel |
| `vite.config.js` | Build setup, PWA settings (name, colors, icons, offline photo cache) and the local dev API |
| `public/` | App icons |

## Where your data is stored

There is no database. Everything the app remembers is saved in your own browser (localStorage) on that device:

- your ingredients, budget, equipment and servings
- your saved recipes
- the photos you add to dishes (shrunk to save space)
- which quick-add ingredients you use most

This means nothing is shared between devices, and clearing your browser data or uninstalling the app removes it. Browsers allow roughly 5 MB, so the app shows a warning if photo storage fills up.

## 1. Get a free API key (Google Gemini)

1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key** and copy it.

Notes about the free tier:

- It has rate limits (requests per minute and per day). You can see your exact limits in Google AI Studio. Normal personal use fits comfortably.
- Google says content sent on the free tier may be used to improve their products. Ingredient lists and food photos are harmless, but do not photograph or type personal information.
- Google requires users to be 18 or older.
- Free-tier terms can change, so check https://ai.google.dev/gemini-api/docs/pricing if something stops working.

## 2. Run it on your computer

You need Node.js 18 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

On Windows, copy `.env.example` to a new file named `.env` instead of using `cp`. Open `.env` and paste your key after `GEMINI_API_KEY=`. Open the link `npm run dev` prints (usually http://localhost:5173).

Restart `npm run dev` after editing `.env`.

## 3. Put it online (free)

**With GitHub:**

1. Push this folder to a GitHub repository. `.env` is ignored, so your key is not uploaded.
2. Go to https://vercel.com, sign in, choose **Add New, Project** and pick the repo.
3. Under **Environment Variables**, add `GEMINI_API_KEY` with your key.
4. Click **Deploy**.

**With the Vercel command line:**

```bash
npm i -g vercel
vercel login
vercel --prod
```

When asked, link to the existing project if you already have one. Add `GEMINI_API_KEY` in the project's **Settings, Environment Variables** on vercel.com.

Open the link on your phone:

- **Android (Chrome):** menu, then *Install app* or *Add to Home screen*
- **iPhone (Safari):** Share, then *Add to Home Screen*

## Switching to Claude (optional)

If you get a Claude API key (it needs prepaid credits), add `ANTHROPIC_API_KEY` to your `.env` or to Vercel's environment variables. If both keys exist, set `AI_PROVIDER=claude` to use Claude, or `AI_PROVIDER=gemini` to stay on the free one.

## Settings you can change

| Setting | Where | Default |
| --- | --- | --- |
| Gemini model | `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| Claude model | `ANTHROPIC_MODEL` | `claude-sonnet-5-5` |
| Force one provider | `AI_PROVIDER` (`gemini` or `claude`) | whichever key is set |
| Colors and app name | `vite.config.js` (manifest) and the top of `src/styles.css` | Fridge Chef, orange |
| Quick-add ingredients, budgets, equipment | the lists at the top of `src/App.jsx` | Filipino staples |
| How the AI behaves | `SYSTEM_PROMPT` in `api/recipes.js` | best place to experiment |

## About the dish photos

The app searches Wikipedia for the dish name and uses the top result only when its title closely matches the dish. Photos come from volunteers, so they will not always look like your exact dish. If no good match is found, you will see a plate icon and an **Add your photo** button.

Photos are credited on the card ("Photo: Wikipedia") and are cached by the service worker so saved recipes keep their pictures offline once they have loaded.

## Troubleshooting

- **"No AI key found"**: your `.env` file is missing, or the key is not set in Vercel. Restart `npm run dev` after editing `.env`.
- **"The API key was rejected"**: the key is wrong or has extra spaces.
- **"Too many requests right now"**: you hit the free rate limit. Wait a minute, or until tomorrow if it was the daily limit.
- **Recipes or photo scans time out on Vercel**: make sure `vercel.json` is in the project and was deployed.
- **A dish shows a plate icon instead of a photo**: no good Wikipedia match was found, or you are offline. This is expected for unusual dishes.
- **Photo scan fails or says the photos are too large**: try a closer, clearer photo or fewer photos.
- **The camera button opens a file picker on a computer**: that is normal. On a phone it opens the camera.
- **Changes do not show on the installed app**: close the app fully and reopen it so the new version loads.

## Roadmap

- [x] Type ingredients and get recipes
- [x] Photo scan of your fridge
- [x] Budget, equipment and servings
- [x] Dish photos and your own photos
- [x] New ideas without repeating dishes
- [x] Cook mode with timers
- [x] Saved recipes, installable PWA, offline for saved recipes
- [ ] Pantry staples that the app remembers
- [ ] "Cooked this week" history
- [ ] Accounts and sync across devices with Supabase

Estimates only. Cook food thoroughly.
