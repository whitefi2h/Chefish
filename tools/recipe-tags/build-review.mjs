import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('resources/recipe-tags/catalog.v1.json', root), 'utf8'));
const ids = new Set(catalog.tags.map(t => t.id));
if (ids.size !== catalog.tags.length) throw new Error('Duplicate tag ID');
for (const tag of catalog.tags) {
  if (!catalog.groups.some(g => g.id === tag.group)) throw new Error(`Unknown group: ${tag.id}`);
  for (const parent of tag.broaderIds) {
    if (!ids.has(parent)) throw new Error(`Unknown broader tag: ${parent}`);
    const seen = new Set([tag.id]);
    const visit = id => {
      if (seen.has(id)) throw new Error(`Cycle: ${tag.id}`);
      seen.add(id);
      for (const p of catalog.tags.find(t => t.id === id).broaderIds) visit(p);
      seen.delete(id);
    };
    visit(parent);
  }
}
const template = await readFile(new URL('tools/recipe-tags/review.template.html', root), 'utf8');
await writeFile(new URL('docs/recipe-tags-review.html', root), template.replace('__CATALOG__', JSON.stringify(catalog).replaceAll('<', '\\u003c')));
console.log(`${catalog.tags.length} tags; ${catalog.tags.filter(t => t.defaultEnabled).length} enabled; review generated.`);
