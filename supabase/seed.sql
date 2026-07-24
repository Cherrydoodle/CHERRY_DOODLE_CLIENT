-- The catalog is seeded as drafts because Cloudinary assets are environment-specific.
-- Upload/attach ready media, then publish through the admin API.

insert into public.categories (slug, name, emoji, sort_order) values
  ('writing-tools', 'Writing Tools', '✏️', 10),
  ('paper-goods', 'Paper Goods', '📓', 20),
  ('stickers-deco', 'Stickers & Deco', '🌸', 30),
  ('bags-pouches', 'Bags & Pouches', '🎒', 40),
  ('bottles-lifestyle', 'Bottles & Lifestyle', '🍶', 50)
on conflict (slug) do update set name = excluded.name, emoji = excluded.emoji, sort_order = excluded.sort_order;

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

insert into public.colors (name, slug, hex_code, sort_order) values
  ('Cherry', 'cherry', '#f4a4b8', 10),
  ('Blush', 'blush', '#f7d6dd', 20),
  ('Cream', 'cream', '#fbeadd', 30),
  ('Lilac', 'lilac', '#e0c9f0', 40),
  ('Mint', 'mint', '#c9ecdc', 50),
  ('Peach', 'peach', '#f9c9b3', 60)
on conflict (slug) do update set name = excluded.name, hex_code = excluded.hex_code, sort_order = excluded.sort_order;

insert into public.products (
  slug, name, label, description, material, size, base_price_cents, sale_price_cents,
  aggregate_rating, review_count, featured_sort_order, status
) values
  ('cherry-bunny-gel-pen-set', 'Cherry Bunny Gel Pen Set', 'Set of 4 Gel Pens', 'Buttery-smooth 0.5mm gel ink with a tiny bunny charm dangling from each cap. Made for journaling, note-taking, and turning your desk into a soft pink dream.', 'ABS plastic, gel ink', '14 cm each', 116200, 91300, 4.80, 214, 10, 'draft'),
  ('pastel-cloud-sticky-notes', 'Pastel Cloud Sticky Notes', '80 sheets', 'Fluffy little cloud-shaped sticky notes in dreamy pastel layers. Perfect for planner spreads, textbook tabs, and leaving cute reminders around the house.', 'Recycled paper', '7 x 7 cm', 49800, null, 4.70, 342, 20, 'draft'),
  ('kawaii-cat-sticker-pack', 'Kawaii Cat Sticker Pack', '13 die-cut stickers', 'A tiny cat colony that lives on your notebook. Waterproof matte finish, made for laptops, water bottles, planners, and phone cases.', 'Vinyl, matte finish', 'Sheet 10 x 14 cm', 41500, null, 4.90, 528, 30, 'draft'),
  ('blush-pink-study-bottle', 'Blush Pink Study Bottle', '500 ml, leak-proof', 'A soft-touch matte bottle with a sakura print, made to sit prettily on your desk during long study sessions. Fits in most bag pockets.', 'Stainless steel + silicone', '500 ml', 232400, 182600, 4.60, 189, 40, 'draft'),
  ('seoul-doodle-notebook', 'Seoul Doodle Notebook', 'A5 spiral, 120 pages', 'Thick dot-grid pages with a sturdy pastel cover doodled in Seoul-inspired icons. Elastic closure and a satin ribbon keep your spreads safe.', 'FSC paper, PU cover', 'A5 (14.8 x 21 cm)', 99600, null, 4.70, 156, 50, 'draft'),
  ('strawberry-milk-washi-tape', 'Strawberry Milk Washi Tape Set', 'Set of 4 rolls', 'Four rolls of dreamy strawberry-milk washi in tonal pinks. Tear-friendly, layer-friendly, and perfect for scrapbooks and gift wrap.', 'Japanese washi paper', '15 mm x 5 m', 74700, null, 4.80, 271, 60, 'draft'),
  ('mini-heart-pencil-pouch', 'Mini Heart Pencil Pouch', 'Heart-shaped pouch', 'A puffy heart-shaped pouch with a gold zipper pull. Big enough for pens, lip balms, and small treasures — small enough to be cute anywhere.', 'Vegan leather', '16 x 14 cm', 149400, 124500, 4.50, 98, 70, 'draft'),
  ('dreamy-planner-sticker-kit', 'Dreamy Planner Sticker Kit', '10 sticker sheets', 'A full month of dreamy planner deco: icons, functional labels, headers, and washi-strip stickers all in one kit.', 'Matte sticker paper', '10 x A5 sheets', 91300, null, 4.90, 402, 80, 'draft'),
  ('peach-cream-journal', 'Peach Cream Journal', 'Hardcover, 200 pages', 'A soft peach hardcover journal with gold accents, a magnetic clasp, and cotton-feel pages. Made for slow mornings and long thoughts.', 'Vegan leather, cotton paper', 'A5', 199200, null, 4.80, 143, 90, 'draft'),
  ('soft-bear-highlighter-set', 'Soft Bear Highlighter Set', 'Set of 4 highlighters', 'Tiny bear-shaped highlighters with mild pastel ink that will not shout on your page. Chisel tip for both broad strokes and detail work.', 'ABS plastic', '10 cm each', 107900, null, 4.60, 176, 100, 'draft'),
  ('pink-sakura-memo-pad', 'Pink Sakura Memo Pad', '100 sheets', 'A soft sakura-illustrated memo pad for love notes, to-do lists, and little kindnesses left on someone’s desk.', 'Recycled paper', '10 x 12 cm', 58100, null, 4.70, 88, 110, 'draft'),
  ('cozy-desk-deco-kit', 'Cozy Desk Deco Kit', '8-piece desk set', 'Everything you need to soften your desk: a mini memo tray, heart clips, blush erasers, and a matching pen — all in one gift-ready box.', 'Mixed', 'Various', 282200, 232400, 4.80, 122, 120, 'draft')
on conflict (slug) do update set
  name = excluded.name, label = excluded.label, description = excluded.description, material = excluded.material,
  size = excluded.size, base_price_cents = excluded.base_price_cents, sale_price_cents = excluded.sale_price_cents,
  aggregate_rating = excluded.aggregate_rating, review_count = excluded.review_count,
  featured_sort_order = excluded.featured_sort_order;

insert into public.product_categories (product_id, category_id, is_primary)
select p.id, c.id, true
from (values
  ('cherry-bunny-gel-pen-set', 'gel-pens'),
  ('pastel-cloud-sticky-notes', 'sticky-notes'),
  ('kawaii-cat-sticker-pack', 'character-stickers'),
  ('blush-pink-study-bottle', 'water-bottles'),
  ('seoul-doodle-notebook', 'notebooks'),
  ('strawberry-milk-washi-tape', 'washi-tapes'),
  ('mini-heart-pencil-pouch', 'pencil-cases'),
  ('dreamy-planner-sticker-kit', 'planner-stickers'),
  ('peach-cream-journal', 'journals'),
  ('soft-bear-highlighter-set', 'highlighters'),
  ('pink-sakura-memo-pad', 'memo-pads'),
  ('cozy-desk-deco-kit', 'desk-accessories')
) as mapping(product_slug, category_slug)
join public.products p on p.slug = mapping.product_slug
join public.categories c on c.slug = mapping.category_slug
on conflict (product_id, category_id) do update set is_primary = true;

insert into public.product_variants (product_id, color_id, sku, stock_quantity, low_stock_threshold, sort_order)
select p.id, c.id, mapping.sku, 100, 5, mapping.sort_order
from (values
  ('cherry-bunny-gel-pen-set','cherry','CD-PEN-CHERRY',10), ('cherry-bunny-gel-pen-set','blush','CD-PEN-BLUSH',20), ('cherry-bunny-gel-pen-set','cream','CD-PEN-CREAM',30), ('cherry-bunny-gel-pen-set','lilac','CD-PEN-LILAC',40),
  ('pastel-cloud-sticky-notes','blush','CD-STICKY-BLUSH',10), ('pastel-cloud-sticky-notes','cream','CD-STICKY-CREAM',20), ('pastel-cloud-sticky-notes','mint','CD-STICKY-MINT',30),
  ('kawaii-cat-sticker-pack','cherry','CD-CAT-CHERRY',10), ('kawaii-cat-sticker-pack','cream','CD-CAT-CREAM',20), ('kawaii-cat-sticker-pack','peach','CD-CAT-PEACH',30),
  ('blush-pink-study-bottle','blush','CD-BOTTLE-BLUSH',10), ('blush-pink-study-bottle','cream','CD-BOTTLE-CREAM',20), ('blush-pink-study-bottle','mint','CD-BOTTLE-MINT',30), ('blush-pink-study-bottle','lilac','CD-BOTTLE-LILAC',40),
  ('seoul-doodle-notebook','blush','CD-NOTEBOOK-BLUSH',10), ('seoul-doodle-notebook','cream','CD-NOTEBOOK-CREAM',20),
  ('strawberry-milk-washi-tape','cherry','CD-WASHI-CHERRY',10), ('strawberry-milk-washi-tape','blush','CD-WASHI-BLUSH',20), ('strawberry-milk-washi-tape','cream','CD-WASHI-CREAM',30),
  ('mini-heart-pencil-pouch','blush','CD-POUCH-BLUSH',10), ('mini-heart-pencil-pouch','cherry','CD-POUCH-CHERRY',20), ('mini-heart-pencil-pouch','cream','CD-POUCH-CREAM',30),
  ('dreamy-planner-sticker-kit','cherry','CD-PLANNER-CHERRY',10), ('dreamy-planner-sticker-kit','blush','CD-PLANNER-BLUSH',20), ('dreamy-planner-sticker-kit','mint','CD-PLANNER-MINT',30), ('dreamy-planner-sticker-kit','lilac','CD-PLANNER-LILAC',40),
  ('peach-cream-journal','peach','CD-JOURNAL-PEACH',10), ('peach-cream-journal','cream','CD-JOURNAL-CREAM',20), ('peach-cream-journal','blush','CD-JOURNAL-BLUSH',30),
  ('soft-bear-highlighter-set','blush','CD-HIGHLIGHT-BLUSH',10), ('soft-bear-highlighter-set','cream','CD-HIGHLIGHT-CREAM',20), ('soft-bear-highlighter-set','peach','CD-HIGHLIGHT-PEACH',30),
  ('pink-sakura-memo-pad','blush','CD-MEMO-BLUSH',10), ('pink-sakura-memo-pad','cream','CD-MEMO-CREAM',20),
  ('cozy-desk-deco-kit','blush','CD-DESK-BLUSH',10), ('cozy-desk-deco-kit','cream','CD-DESK-CREAM',20)
) as mapping(product_slug, color_slug, sku, sort_order)
join public.products p on p.slug = mapping.product_slug
join public.colors c on c.slug = mapping.color_slug
on conflict (sku) do update set color_id = excluded.color_id, stock_quantity = excluded.stock_quantity, sort_order = excluded.sort_order;

insert into public.product_badges (product_id, badge)
select p.id, mapping.badge::public.product_badge
from (values
  ('cherry-bunny-gel-pen-set','bestseller'), ('cherry-bunny-gel-pen-set','sale'),
  ('pastel-cloud-sticky-notes','bestseller'),
  ('kawaii-cat-sticker-pack','new'), ('kawaii-cat-sticker-pack','bestseller'),
  ('blush-pink-study-bottle','sale'),
  ('seoul-doodle-notebook','bestseller'),
  ('strawberry-milk-washi-tape','new'),
  ('mini-heart-pencil-pouch','sale'),
  ('dreamy-planner-sticker-kit','bestseller'),
  ('peach-cream-journal','new'),
  ('soft-bear-highlighter-set','new'),
  ('cozy-desk-deco-kit','sale'), ('cozy-desk-deco-kit','bestseller')
) as mapping(product_slug, badge)
join public.products p on p.slug = mapping.product_slug
on conflict do nothing;

insert into public.content_blocks (key, eyebrow, title, body, primary_label, primary_href, secondary_label, secondary_href, is_active)
values
  ('home.hero', 'New Arrivals', 'New Arrivals for a sweeter desk', 'Cute Korean stationery made for everyday joy — pens, stickers, notebooks, and pastel little things.', 'Shop New Arrivals', '/category/paper-goods', 'Explore Stickers', '/category/stickers-deco', true),
  ('home.sale-banner', 'Limited time', 'Sweet Sale — up to 30% off', 'Blush bottles, heart pouches, dreamy sticker kits and more.', 'Shop the Sale', '/category/bottles-lifestyle?sale=true', null, null, true)
on conflict (key) do update set title = excluded.title, body = excluded.body, primary_label = excluded.primary_label,
  primary_href = excluded.primary_href, secondary_label = excluded.secondary_label, secondary_href = excluded.secondary_href;
