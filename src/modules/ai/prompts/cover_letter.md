Write a concise cover letter for {{full_name}} applying for {{job_title}} at {{company}}.
Use only facts from the profile below. Tone: {{tone}}. Length: 180-250 words, 3 short paragraphs, no clichés ("I am writing to express"), no placeholders.
Paragraph 1: role + one specific reason for this company drawn from the job text.
Paragraph 2: two achievements from the profile most relevant to the top requirements: {{top_requirements}}.
Paragraph 3: availability ({{availability}}) and a clear close.
<profile>{{profile_json}}</profile>
<job>{{job_description}}</job>
Return ONLY JSON: {"subject": str, "body": str}
