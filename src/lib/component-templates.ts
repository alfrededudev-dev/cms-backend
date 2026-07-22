import { IMAGE_PLACEHOLDER_URL } from "./image-placeholder.js"
import { DEFAULT_CONTACT_FORM_FIELDS } from "./site-form-defaults.js"
import { DEFAULT_PROPS_SCHEMA, type ComponentPropsSchema } from "./component-prop-schema.js"
import { DEFAULT_COMPONENT_KIND, type ComponentKind } from "./component-kind.js"

export const DEFAULT_VARIANT_ASTRO_TEMPLATE = `---
import CmsRichText from "../../CmsRichText.astro"

interface Props {
  title?: string
  image?: { src?: string; alt?: string }
  body?: string
}

const { title = "Block title", image = { src: "${IMAGE_PLACEHOLDER_URL}", alt: "" }, body = "" } = Astro.props
---

<section class="bg-background text-foreground">
  <div class="border-border bg-muted container rounded-xl border py-14 md:py-20">
    <div class="flex flex-col gap-6 md:flex-row md:items-center">
      <img
        src={image.src}
        alt={image.alt}
        class="border-border aspect-video w-full max-w-md rounded-lg border-2 object-cover"
        loading="lazy"
        decoding="async"
      />
      <div class="flex flex-col gap-3 md:gap-4">
        <h2 class="text-primary text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
        <div class="text-secondary text-sm font-medium">Secondary accent line</div>
        <CmsRichText html={body} class="text-foreground" />
        <a href="#" class="bg-accent text-background inline-flex w-fit rounded-md px-4 py-2 text-sm font-medium">
          Accent action
        </a>
      </div>
    </div>
    <div class="bg-bg-light border-border text-foreground mt-8 rounded-lg border p-4 text-sm">
      Light surface sample
    </div>
    <div class="bg-bg-dark text-background mt-3 rounded-lg p-4 text-sm">
      Dark surface sample
    </div>
  </div>
</section>
`

export const DEFAULT_PREVIEW_PROPS: Record<string, unknown> = {
  title: "Block title",
  image: { src: IMAGE_PLACEHOLDER_URL, alt: "" },
  body: "<p>Edit this block in the CMS component editor.</p>",
}

export const DEFAULT_LAYOUT_VARIANT_ASTRO_TEMPLATE = `---
interface Props {
  // Add layout props in the CMS editor
}
---

<div class="bg-background text-foreground min-h-screen">
  <header class="border-border bg-primary text-background border-b px-6 py-4">
    <div class="text-sm font-medium">Layout header · primary</div>
  </header>
  <main class="bg-bg-light">
    <!-- Page template blocks from the CMS render here -->
    <slot />
  </main>
  <footer class="bg-bg-dark text-background px-6 py-4 text-sm">
    Layout footer · bg-dark
  </footer>
</div>
`

export const DEFAULT_LAYOUT_PROPS_SCHEMA = {}

export const DEFAULT_LAYOUT_PREVIEW_PROPS = {}

export const DEFAULT_FORM_VARIANT_ASTRO_TEMPLATE = `---
import FormField from "../../FormField.astro"
import type { FormFieldSchema } from "../../FormField.astro"

interface Props {
  formSlug?: string
  submitUrl?: string
  fields?: FormFieldSchema[]
  successMessage?: string
  redirectUrl?: string
  submitLabel?: string
}

const {
  formSlug = "contact",
  submitUrl = "",
  fields = [],
  successMessage = "Thank you! Your message has been sent.",
  redirectUrl = "",
  submitLabel = "Send message",
} = Astro.props

function findField(key: string) {
  return fields.find((field) => field.key === key) ?? null
}

const placedKeys = new Set(["name", "email", "phone", "message"])
const extraFields = fields.filter((field) => !placedKeys.has(field.key))
const canSubmit = Boolean(submitUrl)
const showForm = canSubmit || fields.length > 0
---

<section class="bg-background text-foreground container py-14 md:py-20">
  <div class="border-border bg-muted mx-auto max-w-xl rounded-xl border p-6">
    {!showForm ? (
      <p class="text-muted-foreground text-sm">
        Define form fields in component Props, then add this block to a site template with formSlug.
      </p>
    ) : (
      <form
        class="cms-form flex flex-col gap-6"
        data-cms-form
        data-form-slug={formSlug}
        data-submit-url={submitUrl}
        data-success-message={successMessage}
        data-redirect-url={redirectUrl}
      >
        <div class="flex flex-col gap-2">
          <h2 class="text-primary text-2xl font-semibold tracking-tight">Contact us</h2>
          <p class="text-secondary text-sm">
            Layout in code; fields from component Props (synced to the site on template save).
          </p>
        </div>

        {!canSubmit ? (
          <p class="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
            Preview mode — submit URL is injected when this form is placed on a site.
          </p>
        ) : null}

        <div class="grid gap-4 md:grid-cols-2">
          {findField("name") ? <FormField field={findField("name")!} /> : null}
          {findField("email") ? <FormField field={findField("email")!} /> : null}
        </div>

        {findField("phone") ? <FormField field={findField("phone")!} /> : null}
        {findField("message") ? <FormField field={findField("message")!} /> : null}

        {extraFields.length > 0 ? (
          <div class="flex flex-col gap-4 border-t pt-4">
            {extraFields.map((field) => (
              <FormField field={field} />
            ))}
          </div>
        ) : null}

        <input type="text" name="_gotcha" tabindex="-1" autocomplete="off" class="hidden" aria-hidden="true" />

        <button
          type="submit"
          class="bg-primary text-primary-foreground inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          {submitLabel}
        </button>
      </form>
    )}
  </div>
</section>

<script is:inline>
  function collectFormData(form) {
    const data = {}
    for (const [key, value] of new FormData(form).entries()) {
      if (key.includes(".")) {
        const parts = key.split(".")
        let cursor = data
        for (let index = 0; index < parts.length - 1; index += 1) {
          const part = parts[index]
          if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {}
          cursor = cursor[part]
        }
        cursor[parts[parts.length - 1]] = String(value)
      } else {
        data[key] = String(value)
      }
    }
    return data
  }

  function showFormMessage(form, message, isError) {
    let node = form.querySelector("[data-cms-form-message]")
    if (!node) {
      node = document.createElement("p")
      node.dataset.cmsFormMessage = "true"
      node.className = "cms-form__message text-sm mt-3"
      form.appendChild(node)
    }
    node.textContent = message
    node.classList.toggle("text-destructive", Boolean(isError))
    node.classList.toggle("text-muted-foreground", !isError)
  }

  function bindForm(form) {
    if (!(form instanceof HTMLFormElement) || form.dataset.cmsFormBound === "true") return
    form.dataset.cmsFormBound = "true"
    form.addEventListener("submit", async (event) => {
      event.preventDefault()
      const submitUrl = form.dataset.submitUrl
      if (!submitUrl) {
        showFormMessage(form, "Preview only — submit URL is set when the form is on a site.", true)
        return
      }
      const submitButton = form.querySelector('[type="submit"]')
      if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true
      try {
        const response = await fetch(submitUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: collectFormData(form), pageUrl: window.location.href }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.message || "Submit failed")
        showFormMessage(form, payload.message || form.dataset.successMessage || "Thank you!")
        form.reset()
        const redirectUrl = payload.redirectUrl || form.dataset.redirectUrl
        if (redirectUrl) window.location.href = redirectUrl
      } catch (error) {
        showFormMessage(form, error instanceof Error ? error.message : "Submit failed", true)
      } finally {
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false
      }
    })
  }

  function initForms(root) {
    root.querySelectorAll("form[data-cms-form]").forEach(bindForm)
  }

  initForms(document)
  document.addEventListener("astro:page-load", () => initForms(document))
</script>
`

export const DEFAULT_FORM_PROPS_SCHEMA = {
  formSlug: { type: "siteForm", label: "Form slug (site link)" },
  fields: { type: "formFields", label: "Form fields" },
  submitLabel: { type: "text", label: "Submit button label" },
  successMessage: { type: "text", label: "Success message" },
  redirectUrl: { type: "text", label: "Redirect URL (optional)" },
}

export const DEFAULT_FORM_PREVIEW_PROPS = {
  formSlug: "contact",
  submitLabel: "Send message",
  submitUrl: "",
  successMessage: "Thank you! Your message has been sent.",
  redirectUrl: "",
  fields: DEFAULT_CONTACT_FORM_FIELDS.map(({ key, label, type, required, options }) => ({
    key,
    label,
    type,
    ...(required ? { required } : {}),
    ...(options ? { options } : {}),
  })),
}

export function getComponentKindDefaults(kind: ComponentKind = DEFAULT_COMPONENT_KIND) {
  if (kind === "layout") {
    return {
      template: DEFAULT_LAYOUT_VARIANT_ASTRO_TEMPLATE,
      propsSchema: DEFAULT_LAYOUT_PROPS_SCHEMA,
      previewProps: DEFAULT_LAYOUT_PREVIEW_PROPS,
    }
  }

  if (kind === "form") {
    return {
      template: DEFAULT_FORM_VARIANT_ASTRO_TEMPLATE,
      propsSchema: DEFAULT_FORM_PROPS_SCHEMA,
      previewProps: DEFAULT_FORM_PREVIEW_PROPS,
    }
  }

  return {
    template: DEFAULT_VARIANT_ASTRO_TEMPLATE,
    propsSchema: DEFAULT_PROPS_SCHEMA,
    previewProps: DEFAULT_PREVIEW_PROPS,
  }
}

export { DEFAULT_PROPS_SCHEMA }
