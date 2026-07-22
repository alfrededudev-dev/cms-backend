import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { syncPropsToAstroFrontmatter } from "./component-code-sync.js"
import { normalizePropsSchema } from "./component-prop-schema.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const brokenCode = readFileSync(
  path.resolve(__dirname, "../../../workspaces/component-preview/src/components/blocks/another-component/Default.astro"),
  "utf8",
)

const schema = normalizePropsSchema({
  title: { type: "text", label: "Title" },
  description: { type: "textarea", label: "Description" },
  link: { type: "link", label: "Link" },
  steps: {
    type: "repeater",
    label: "Steps",
    fields: {
      title: { type: "text", label: "Title" },
    },
  },
  image: { type: "media", label: "Image" },
})

const previewProps = {
  title: "Title example",
  description: "Applying to university is a significant step in your life.",
  link: { title: "Read more", href: "#", target: "_self" },
  steps: [],
  image: { src: "https://placehold.co/1000x1000", alt: "sdfsdfsdfsdfsdf" },
}

const synced = syncPropsToAstroFrontmatter(brokenCode, schema, previewProps)

assert.equal((synced.match(/interface Props/g) ?? []).length, 1, "interface Props should appear once")
assert.doesNotMatch(synced, /CmsImage|CmsLink/, "CmsImage/CmsLink must be removed")
assert.match(synced, /image\?: \{ src\?: string; alt\?: string \}/, "image must be an object type")
assert.match(synced, /image = \{ src: "https:\/\/placehold\.co\/1000x1000"/, "image default src must use placeholder")
assert.doesNotMatch(synced, /steps\?: Array<\{\s*title\?: string;\s*\}\>\s*\}\s*steps\?:/, "orphan prop lines must be removed")
assert.match(synced, /const \{[\s\S]*\} = Astro\.props/, "destructure line must exist once")

console.log("component-code-sync tests passed")
