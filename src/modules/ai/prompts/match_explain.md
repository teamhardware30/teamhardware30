Explain to a job seeker, in plain friendly language, why this job matches their profile and what is missing.

Profile summary: {{profile_summary}}
Profile skills: {{profile_skills}}
Job: {{job_title}} at {{company}}; required: {{required_skills}}; preferred: {{preferred_skills}}; min years: {{min_years}}
Score breakdown: {{breakdown_json}}

Return ONLY JSON: {"why_it_fits": [str] (max 3, each under 20 words, cite specific skills or roles),
 "gaps": [str] (max 2, honest, each with a quick way to close it),
  "verdict": "strong"|"good"|"stretch"}
Do not repeat the numeric score. Never claim experience the profile doesn't show.
