-- Minimal reference data for a real (non-demo) environment.
--
-- Contains ONLY the taxonomy rows the storefront navigation and the admin
-- product form cannot work without: categories and colors. No products,
-- variants, badges, or marketing copy — those are created in the admin panel.
--
-- Lives in a migration rather than in seed.sql for the same reason
-- role_permissions (202607140001) and the store_settings singleton
-- (202607150002) do: it is required data, not demo data, so every environment
-- must receive it from `supabase db push`. seed.sql stays local-only.
--
-- Idempotent: every statement upserts, so re-running changes nothing.

-- Top-level categories.
insert into public.categories (slug, name, emoji, sort_order) values
  ('writing-tools', 'Writing Tools', '✏️', 10),
  ('paper-goods', 'Paper Goods', '📓', 20),
  ('stickers-deco', 'Stickers & Deco', '🌸', 30),
  ('bags-pouches', 'Bags & Pouches', '🎒', 40),
  ('bottles-lifestyle', 'Bottles & Lifestyle', '🍶', 50)
on conflict (slug) do update set name = excluded.name, emoji = excluded.emoji, sort_order = excluded.sort_order;

-- Sub-categories, resolved against the parents inserted above.
insert into public.categories (parent_id, slug, name, sort_order)
select parent.id, child.slug, child.name, child.sort_order
from (values
  ('writing-tools', 'gel-pens', 'Gel Pens', 10),
  ('writing-tools', 'highlighters', 'Highlighters', 20),
  ('writing-tools', 'pencils', 'Pencils', 30),
  ('writing-tools', 'markers', 'Markers', 40),
  ('paper-goods', 'notebooks', 'Notebooks', 10),
  ('paper-goods', 'journals', 'Journals', 20),
  ('paper-goods', 'sticky-notes', 'Sticky Notes', 30),
  ('paper-goods', 'memo-pads', 'Memo Pads', 40),
  ('stickers-deco', 'character-stickers', 'Character Stickers', 10),
  ('stickers-deco', 'planner-stickers', 'Planner Stickers', 20),
  ('stickers-deco', 'washi-tapes', 'Washi Tapes', 30),
  ('stickers-deco', 'scrapbook-sets', 'Scrapbook Sets', 40),
  ('bags-pouches', 'pencil-cases', 'Pencil Cases', 10),
  ('bags-pouches', 'mini-pouches', 'Mini Pouches', 20),
  ('bags-pouches', 'tote-bags', 'Tote Bags', 30),
  ('bottles-lifestyle', 'water-bottles', 'Water Bottles', 10),
  ('bottles-lifestyle', 'tumblers', 'Tumblers', 20),
  ('bottles-lifestyle', 'desk-accessories', 'Desk Accessories', 30)
) as child(parent_slug, slug, name, sort_order)
join public.categories parent on parent.slug = child.parent_slug
on conflict (slug) do update set parent_id = excluded.parent_id, name = excluded.name, sort_order = excluded.sort_order;

-- Variant colors. Product variants require a color_id, so the palette must
-- exist before the first product can be created in the admin panel.
insert into public.colors (name, slug, hex_code, sort_order) values
  ('Cherry', 'cherry', '#f4a4b8', 10),
  ('Blush', 'blush', '#f7d6dd', 20),
  ('Cream', 'cream', '#fbeadd', 30),
  ('Lilac', 'lilac', '#e0c9f0', 40),
  ('Mint', 'mint', '#c9ecdc', 50),
  ('Peach', 'peach', '#f9c9b3', 60)
on conflict (slug) do update set name = excluded.name, hex_code = excluded.hex_code, sort_order = excluded.sort_order;
