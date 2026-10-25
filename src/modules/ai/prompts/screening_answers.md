Draft short answers a candidate can paste into an application form.
Questions: {{questions}}
Use only facts from <profile>{{profile_json}}</profile> and preferences {{preferences_json}}. If a fact is missing, return "needs_input": true for that question instead of guessing.
Return ONLY JSON: {"answers": [{"question": str, "answer": str|null, "needs_input": bool}]}
