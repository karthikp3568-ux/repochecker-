/** Convert a title into a lowercase, hyphen-separated URL slug. */
export function slugify(title, { maxLength = 80 } = {}) {
  if (typeof title !== "string") throw new TypeError("title must be a string");
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLength).replace(/-+$/, "");
}
