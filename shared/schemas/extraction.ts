import { z } from 'zod';

// ── SkillSet: required / preferred per dimension ──────────────────────────────

export const SkillSetSchema = z.object({
  required:  z.array(z.string()),
  preferred: z.array(z.string()),
});

export type SkillSet = z.infer<typeof SkillSetSchema>;

// ── Experience level ──────────────────────────────────────────────────────────

// Preprocess handles model quirks: "<nil>", "null", "none", "" → null
const VALID_LEVELS = new Set(['junior', 'mid', 'senior', 'lead']);

export const ExperienceLevelSchema = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      const norm = val.trim().toLowerCase();
      // Return null for any value that isn't a recognised enum member
      if (!VALID_LEVELS.has(norm)) return null;
      return norm;
    }
    return val;
  },
  z.enum(['junior', 'mid', 'senior', 'lead']).nullable(),
);

// ── Main extraction result ────────────────────────────────────────────────────

export const ExtractionResultSchema = z.object({
  source_type:           z.enum(['job_posting', 'cv']),
  domain_knowledge:      SkillSetSchema,
  programming_languages: SkillSetSchema,
  tools:                 SkillSetSchema,
  infrastructure:        SkillSetSchema,
  project_management:    SkillSetSchema,
  spoken_languages:      SkillSetSchema,
  soft_skills:           SkillSetSchema,
  experience_level:      ExperienceLevelSchema,
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
export type ExperienceLevel  = z.infer<typeof ExperienceLevelSchema>;

// ── DB row type (each dimension stored as JSON string) ────────────────────────

export interface ExtractedSkillRow {
  id:                    number;
  posting_id:            string;
  source_type:           'job_posting' | 'cv';
  domain_knowledge:      string;  // JSON: { required: string[], preferred: string[] }
  programming_languages: string;
  tools:                 string;
  infrastructure:        string;
  project_management:    string;
  spoken_languages:      string;
  soft_skills:           string;
  experience_level:      string | null;
  extracted_at:          string;
}
