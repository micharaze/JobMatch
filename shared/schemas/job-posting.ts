import { z } from 'zod';

export const JobPostingSchema = z.object({
  id: z.string(),
  source: z.string(),
  url: z.string().url(),
  author: z.string().optional(),
  author_company: z.string().optional(),
  author_email: z.string().optional(),
  author_tel: z.string().optional(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  description: z.string(),
  contract_type: z.string().optional(),
  posted_at: z.string().nullable(),
  scraped_at: z.string(),
  raw_html: z.string().optional(),
});

export type JobPosting = z.infer<typeof JobPostingSchema>;
