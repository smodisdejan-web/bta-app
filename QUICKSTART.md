# Data Insights Quick Start Guide 🚀

## 🎯 Get AI Insights Working in 3 Minutes!

### Option 1: Google Gemini (Recommended - FREE!)

1. **Get a free API key** (takes 30 seconds):
   - Visit: https://makersuite.google.com/app/apikey
   - Click "Create API Key"
   - Copy your key

2. **Add to your project**:
   ```bash
   # In your project root, create/edit .env.local
   echo "NEXT_PUBLIC_GEMINI_API_KEY=your_key_here" >> .env.local
   ```

3. **Restart dev server**:
   ```bash
   # Stop current server (Ctrl+C) then:
   npm run dev
   ```

4. **Done!** Go to http://localhost:3001/insights and try it out!

---

### Option 2: OpenAI GPT-4 (Paid)

1. **Get API key**:
   - Visit: https://platform.openai.com/api-keys
   - Create new key
   - Copy your key

2. **Add to .env.local**:
   ```bash
   NEXT_PUBLIC_OPENAI_API_KEY=your_key_here
   ```

3. **Restart server** and you're ready!

---

### Option 3: Anthropic Claude (Paid)

1. **Get API key**:
   - Visit: https://console.anthropic.com/
   - Create new key
   - Copy your key

2. **Add to .env.local**:
   ```bash
   NEXT_PUBLIC_ANTHROPIC_API_KEY=your_key_here
   ```

3. **Restart server** and you're ready!

---

## 📁 Where to Put API Keys

Create a file called `.env.local` in your project root (same folder as package.json):

```bash
/Users/dejansmodis/Documents/bta-app/.env.local
```

Example `.env.local` file:
```
# Choose at least one:
NEXT_PUBLIC_GEMINI_API_KEY=AIzaSyC...your_key_here
NEXT_PUBLIC_OPENAI_API_KEY=sk-proj-...your_key_here
NEXT_PUBLIC_ANTHROPIC_API_KEY=sk-ant-...your_key_here
```

⚠️ **Important**: Never commit `.env.local` to git! It's already in .gitignore.

---

## 🎉 Test It Out!

Once configured:

1. Navigate to http://localhost:3001/insights
2. Select a data source (e.g., "Search Terms")
3. Click a sample prompt or write your own
4. Click "Generate AI Insights"
5. Watch the magic happen! ✨

---

## 💡 Which Provider to Choose?

| Provider | Cost | Speed | Quality | Best For |
|----------|------|-------|---------|----------|
| **Gemini Pro** | FREE* | Fast | Great | Getting started, testing |
| **GPT-4** | $$$ | Medium | Best | Production, critical analysis |
| **Claude 3** | $$ | Fast | Excellent | Balanced performance |

*Gemini has a generous free tier with rate limits

---

## ❓ Troubleshooting

### "API key not configured" error
- Make sure `.env.local` exists in project root
- Check the key name matches exactly (copy from above)
- Restart dev server after adding keys
- Make sure there are no extra spaces or quotes

### Still not working?
1. Check `.env.local` is in the right location:
   ```bash
   ls -la .env.local
   ```
2. Verify the content:
   ```bash
   cat .env.local
   ```
3. Make sure dev server restarted:
   ```bash
   # Kill all node processes
   pkill -f "next dev"
   # Start fresh
   npm run dev
   ```

---

## 🎓 Next Steps

Once you have AI insights working:
- ✅ Try the sample prompts
- ✅ Experiment with filters
- ✅ Save your favorite filter presets
- ✅ Check out the insight history
- ✅ Export your data
- ✅ Use keyboard shortcuts (Cmd+K, Cmd+Enter, etc.)

Enjoy your 100x better Data Insights page! 🚀


