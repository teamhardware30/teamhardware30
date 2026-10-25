import model from 'wink-eng-lite-web-model';
import winkNLP from 'wink-nlp';

const nlp = winkNLP(model);

export interface KeywordHit {
  keyword: string;
  section: string;
}

export interface KeywordAnalysis {
  hits: KeywordHit[];
  gaps: string[];
  jobKeywords: string[];
}

export function buildJobKeywords(requiredSkills: string[], preferredSkills: string[], description: string): string[] {
  const keywords = [...requiredSkills, ...preferredSkills];
  try {
    const doc = nlp.readDoc(description);
    const values = doc.tokens().out(nlp.its.value) as string[];
    const tags = doc.tokens().out(nlp.its.pos) as string[];
    const phrases = values.filter((_, index) => tags[index] === 'NOUN').map((value) => value.trim()).filter((value) => value.length > 2);
    for (const phrase of phrases.slice(0, 10)) {
      if (!keywords.some((keyword) => keyword.toLowerCase() === phrase.toLowerCase())) keywords.push(phrase);
    }
  } catch {
    // Fall back to skill-only keywords if NLP parsing fails.
  }
  return [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))];
}

export function analyzeKeywords(jobKeywords: string[], resumeText: string, requiredSkills: string[] = []): KeywordAnalysis {
  const sections = splitSections(resumeText);
  const lemmaHelper = nlp.its.lemma as unknown as (token: unknown) => string;
  const lemmas = new Set((nlp.readDoc(resumeText).tokens().out(lemmaHelper) as unknown as string[]).map((value: string) => value.toLowerCase()));
  const hits: KeywordHit[] = [];
  const gaps: string[] = [];

  for (const keyword of jobKeywords) {
    const normalized = keyword.trim().toLowerCase();
    const terms = [normalized, ...normalized.split(/\s+/)];
    const matched = terms.some((term) => lemmas.has(term) || resumeText.toLowerCase().includes(term));
    if (matched) {
      hits.push({ keyword, section: sectionFor(keyword, sections) });
    } else {
      gaps.push(keyword);
    }
  }

  gaps.sort((left, right) => {
    const leftRequired = requiredSkills.includes(left) ? 0 : 1;
    const rightRequired = requiredSkills.includes(right) ? 0 : 1;
    return leftRequired - rightRequired || left.localeCompare(right);
  });

  return { hits, gaps, jobKeywords };
}

function splitSections(text: string): Array<{ name: string; text: string }> {
  const lines = text.split(/\r?\n/);
  const sections: Array<{ name: string; text: string }> = [];
  let current = { name: 'General', text: '' };
  for (const line of lines) {
    if (/^(experience|education|skills|summary|profile|projects|certifications)\b/i.test(line.trim())) {
      if (current.text.trim()) sections.push(current);
      current = { name: line.trim(), text: '' };
    } else {
      current.text += `${line}\n`;
    }
  }
  if (current.text.trim()) sections.push(current);
  return sections.length > 0 ? sections : [{ name: 'General', text }];
}

function sectionFor(keyword: string, sections: Array<{ name: string; text: string }>): string {
  const normalized = keyword.toLowerCase();
  const section = sections.find((item) => item.text.toLowerCase().includes(normalized));
  return section?.name || 'General';
}
