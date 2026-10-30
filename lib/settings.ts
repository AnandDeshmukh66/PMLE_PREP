import { z } from "zod";
import { prisma } from "./db";

export type Settings = {
  examDate: string | null;
  dailyHours: number;
  defaultPracticeMode: string;
  questionsPerSession: number;
  shuffle: boolean;
  immediateFeedback: boolean;
  mockQuestions: number;
  mockMinutes: number;
  mockFallback: "redistribute" | "shrink";
  mockExcludeLegacy: boolean;
  mockOnlyGradable: boolean;
  gradeContested: boolean;
  showTimer: boolean;
  theme: "midnight" | "graphite";
  keyboardShortcuts: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  examDate: null,
  dailyHours: 5,
  defaultPracticeMode: "all",
  questionsPerSession: 20,
  shuffle: true,
  immediateFeedback: true,
  mockQuestions: 60,
  mockMinutes: 120,
  mockFallback: "redistribute",
  mockExcludeLegacy: true,
  mockOnlyGradable: true,
  gradeContested: false,
  showTimer: true,
  theme: "midnight",
  keyboardShortcuts: true,
};

export const SETTINGS_SCHEMA = z
  .object({
    examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    dailyHours: z.number().min(0.5).max(16),
    defaultPracticeMode: z.string().max(40),
    questionsPerSession: z.number().int().min(1).max(200),
    shuffle: z.boolean(),
    immediateFeedback: z.boolean(),
    mockQuestions: z.number().int().min(5).max(120),
    mockMinutes: z.number().int().min(1).max(240),
    mockFallback: z.enum(["redistribute", "shrink"]),
    mockExcludeLegacy: z.boolean(),
    mockOnlyGradable: z.boolean(),
    gradeContested: z.boolean(),
    showTimer: z.boolean(),
    theme: z.enum(["midnight", "graphite"]),
    keyboardShortcuts: z.boolean(),
  })
  .partial()
  .strict();

export async function getSettings(userId: string): Promise<Settings> {
  const rows = await prisma.setting.findMany({ where: { userId } });
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue;
    try {
      const parsed = SETTINGS_SCHEMA.safeParse({ [r.key]: JSON.parse(r.value) });
      if (parsed.success) s[r.key] = (parsed.data as Record<string, unknown>)[r.key];
    } catch {
      /* keep default */
    }
  }
  return s as Settings;
}
