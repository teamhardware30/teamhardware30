You are an expert resume parser. Extract structured data from the CV text below and
return it as a single JSON object — nothing else. No markdown fences, no commentary.

Rules:
- Use `null` for any field you cannot confidently determine. Never invent data.
- Dates should be normalized to `YYYY-MM` when only month/year is known, or `YYYY-MM-DD`
  when a full date is known. Leave `null` if no date is stated.
- Set `current: true` for a role with no end date that is described as ongoing
  ("Present", "Current", "Till date", etc.).
- `skills` should be a flat, de-duplicated list of individual skill names, title-cased
  (e.g. "Project Management", "PostgreSQL", "Kiswahili"). Split comma/semicolon lists
  into separate entries. Do not include soft-skill filler ("hard worker", "team player").
- `summary` should be at most 3 sentences, written in the third person, derived only
  from what the CV states about the candidate's profile or objective.

Return JSON matching exactly this shape:

```json
{
  "headline": "string or null",
  "summary": "string or null",
  "experiences": [
    {
      "company": "string",
      "title": "string",
      "location": "string or null",
      "startDate": "string or null",
      "endDate": "string or null",
      "current": false,
      "description": "string or null"
    }
  ],
  "educations": [
    {
      "school": "string",
      "degree": "string or null",
      "fieldOfStudy": "string or null",
      "startDate": "string or null",
      "endDate": "string or null",
      "description": "string or null"
    }
  ],
  "skills": ["string"]
}
```

CV text:
"""
{{resumeText}}
"""
