# PMLE Prep 🎯

Practice for the Google Cloud **Professional Machine Learning Engineer** exam without scrolling through a 173-page PDF.

## Get it running

You need [Node.js](https://nodejs.org/) 20.9+ and [Git](https://git-scm.com/).

```bash
# 1. Clone
git clone https://github.com/AnandDeshmukh66/PMLE_PREP.git

# 2. Go into the folder
cd PMLE_PREP

# 3. Install (copies the default local settings and loads the questions)
npm install
cp .env.example .env
npm run setup

# 4. Run
npm run dev
```

Open **<http://localhost:3000>**, sign in with your **66 Degrees company email** (no password needed), and start practising. Your progress saves automatically.

## What is PMLE Prep?

I was studying for the PMLE exam from one very long PDF. I kept forgetting which questions I'd done, which ones I got wrong, and whether I'd seen "that BigQuery ML one" before or was just having déjà vu.

So I turned it into a portal: attempt questions, get instant feedback, track progress, fix weak spots. It's for anyone at 66 Degrees preparing for the PMLE.

## Where did the questions come from?

- **The PDF:** `ML_Engineer_Exam_Questions.pdf`, which gave 338 questions. Each one links back to its page in the PDF.
- **ExamPrepper:** [examprepper.co/exam/14](https://www.examprepper.co/exam/14/1), which gave 339 questions. I used it to cross-check the answer keys.

Merged together, that's **339 unique questions**, mapped to the **PMLE exam guide dated June 1, 2026**.

When the sources disagree, the question is labelled and not scored, so you're not memorising a possibly wrong key. Heads-up: neither source has official explanations, and older questions may use old product names (these are flagged).

*This is an independent study tool, not an official Google Cloud product. The [official exam guide](https://cloud.google.com/learn/certification/machine-learning-engineer) is the final word.*

## Why not just read the PDF?

| PDF life | Portal life |
|---|---|
| Peek at the answer, nod wisely | Commit to an answer first, then see if you're right |
| "Did I already do this one?" | Attempt history on every question |
| Ctrl+F through 173 pages | Search and filters |
| Mentally tracking mistakes | **Incorrect Questions** fills itself in |
| Close the PDF, lose your place | Saved automatically, resume anytime |

## What's inside?

- **Dashboard:** progress, domain readiness, and "continue where you left off".
- **Study Plan:** a day-by-day schedule up to your exam date.
- **Practice:** focused sessions by domain, topic, mistakes or weak areas.
- **Mock Examination:** 60 questions in 120 minutes, weighted like the real exam.
- **All / Common / PDF / ExamPrepper Questions:** browse, take notes, flag, bookmark.
- **Marked for Review, Flagged Questions, Incorrect Questions, Bookmarks:** your personal revision piles.
- **Theory Checklist:** 149 concepts from the 2026 guide, gen-AI topics included.
- **Exam Blueprint and Analytics:** where the marks are, and where you stand.
- **Data Quality:** how the bank was built, and how much to trust each answer.
- **Settings:** preferences, Download My Backup, log out.

## How it helps

- **You practise, not just read.** Answering before you look is how stuff actually sticks.
- **Your gaps find you.** Weak areas and the revision queue point you at what needs work.
- **Mistakes turn into notes.** Write down *why* you got it wrong, so future you doesn't repeat it.
- **Exam day feels familiar.** Timed mocks mean the clock isn't a surprise.

Quick tip: learn the *why*, not the option letter, and treat mock scores as feedback, not fortune-telling.

---

All the best for your PMLE examination! Hope you crack it.

Best wishes,
**Anand** ✌️
