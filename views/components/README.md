# Nunjucks components

Import macros explicitly and pass an options object for labels, values, validation, and behavior:

```njk
{% from "components/input.njk" import input %}
{{ input("email", { label: "Email", type: "email", value: values.email, error: fieldErrors.email, required: true }) }}
```

Common options:

- `input`, `textarea`, and `select`: `label`, `value`/`selected`, `hint`, `error`, `required`, `disabled`, `id`, and optional static `attrs`.
- `button`: `variant` (`primary`, `accent`, `danger`, `ghost`), `type`, `disabled`, and optional static `attrs`.
- `checkbox` and `radio`: `checked`, `disabled`, `value`, and `id`.
- `alert`: `variant` (`info`, `success`, `warning`, `error`) and optional `title`.
- `score_ring`: pass a 0–100 score; 80+ is green, 60–79 amber, and below 60 slate.
- Layout and feedback macros include `card`, `badge`, `modal`, `slideover`, `toast`, `empty_state`, `pagination`, and `step_indicator`.

Keep forms progressively enhanced: every HTMX form also has a normal `method` and `action`, and server-side validation returns status 422 with the originating form, submitted values, and field errors. Do not put inline styles or unescaped user input in `attrs`.
