import type { StaticImageData } from "next/image";

import pens from "@/assets/product-pens.jpg";
import stickynotes from "@/assets/product-stickynotes.jpg";
import stickers from "@/assets/product-stickers.jpg";
import bottle from "@/assets/product-bottle.jpg";
import notebook from "@/assets/product-notebook.jpg";
import washi from "@/assets/product-washi.jpg";
import pouch from "@/assets/product-pouch.jpg";
import planner from "@/assets/product-planner.jpg";
import journal from "@/assets/product-journal.jpg";
import highlighter from "@/assets/product-highlighter.jpg";
import memo from "@/assets/product-memo.jpg";
import desk from "@/assets/product-desk.jpg";

export type Product = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  price: number;
  salePrice?: number;
  image: StaticImageData;
  gallery?: StaticImageData[];
  colors: { name: string; hex: string }[];
  rating: number;
  reviews: number;
  badges: ("new" | "bestseller" | "sale")[];
  label: string;
  description: string;
  material: string;
  size: string;
};

export type Category = {
  slug: string;
  name: string;
  emoji: string;
  image: StaticImageData;
  subcategories: { slug: string; name: string }[];
};

import catWritingTools from "@/assets/cat-writing-tools.jpg";
import catPaperGoods from "@/assets/cat-paper-goods.jpg";
import catStickersDeco from "@/assets/cat-stickers-deco.jpg";
import catBagsPouches from "@/assets/cat-bags-pouches.jpg";
import catBottlesLifestyle from "@/assets/cat-bottles-lifestyle.jpg";

export const categories: Category[] = [
  {
    slug: "writing-tools",
    name: "Writing Tools",
    emoji: "✏️",
    image: catWritingTools,
    subcategories: [
      { slug: "gel-pens", name: "Gel Pens" },
      { slug: "highlighters", name: "Highlighters" },
      { slug: "pencils", name: "Pencils" },
      { slug: "markers", name: "Markers" },
    ],
  },
  {
    slug: "paper-goods",
    name: "Paper Goods",
    emoji: "📓",
    image: catPaperGoods,
    subcategories: [
      { slug: "notebooks", name: "Notebooks" },
      { slug: "journals", name: "Journals" },
      { slug: "sticky-notes", name: "Sticky Notes" },
      { slug: "memo-pads", name: "Memo Pads" },
    ],
  },
  {
    slug: "stickers-deco",
    name: "Stickers & Deco",
    emoji: "🌸",
    image: catStickersDeco,
    subcategories: [
      { slug: "character-stickers", name: "Character Stickers" },
      { slug: "planner-stickers", name: "Planner Stickers" },
      { slug: "washi-tapes", name: "Washi Tapes" },
      { slug: "scrapbook-sets", name: "Scrapbook Sets" },
    ],
  },
  {
    slug: "bags-pouches",
    name: "Bags & Pouches",
    emoji: "🎒",
    image: catBagsPouches,
    subcategories: [
      { slug: "pencil-cases", name: "Pencil Cases" },
      { slug: "mini-pouches", name: "Mini Pouches" },
      { slug: "tote-bags", name: "Tote Bags" },
    ],
  },
  {
    slug: "bottles-lifestyle",
    name: "Bottles & Lifestyle",
    emoji: "🍶",
    image: catBottlesLifestyle,
    subcategories: [
      { slug: "water-bottles", name: "Water Bottles" },
      { slug: "tumblers", name: "Tumblers" },
      { slug: "desk-accessories", name: "Desk Accessories" },
    ],
  },
];


const cherry = { name: "Cherry", hex: "#f4a4b8" };
const blush = { name: "Blush", hex: "#f7d6dd" };
const cream = { name: "Cream", hex: "#fbeadd" };
const lilac = { name: "Lilac", hex: "#e0c9f0" };
const mint = { name: "Mint", hex: "#c9ecdc" };
const peach = { name: "Peach", hex: "#f9c9b3" };

export const products: Product[] = [
  {
    id: "cherry-bunny-gel-pen-set",
    name: "Cherry Bunny Gel Pen Set",
    category: "writing-tools",
    subcategory: "gel-pens",
    price: 14,
    salePrice: 11,
    image: pens,
    colors: [cherry, blush, cream, lilac],
    rating: 4.8,
    reviews: 214,
    badges: ["bestseller", "sale"],
    label: "Set of 4 Gel Pens",
    description:
      "Buttery-smooth 0.5mm gel ink with a tiny bunny charm dangling from each cap. Made for journaling, note-taking, and turning your desk into a soft pink dream.",
    material: "ABS plastic, gel ink",
    size: "14 cm each",
  },
  {
    id: "pastel-cloud-sticky-notes",
    name: "Pastel Cloud Sticky Notes",
    category: "paper-goods",
    subcategory: "sticky-notes",
    price: 6,
    image: stickynotes,
    colors: [blush, cream, mint],
    rating: 4.7,
    reviews: 342,
    badges: ["bestseller"],
    label: "80 sheets",
    description:
      "Fluffy little cloud-shaped sticky notes in dreamy pastel layers. Perfect for planner spreads, textbook tabs, and leaving cute reminders around the house.",
    material: "Recycled paper",
    size: "7 x 7 cm",
  },
  {
    id: "kawaii-cat-sticker-pack",
    name: "Kawaii Cat Sticker Pack",
    category: "stickers-deco",
    subcategory: "character-stickers",
    price: 5,
    image: stickers,
    colors: [cherry, cream, peach],
    rating: 4.9,
    reviews: 528,
    badges: ["new", "bestseller"],
    label: "13 die-cut stickers",
    description:
      "A tiny cat colony that lives on your notebook. Waterproof matte finish, made for laptops, water bottles, planners, and phone cases.",
    material: "Vinyl, matte finish",
    size: "Sheet 10 x 14 cm",
  },
  {
    id: "blush-pink-study-bottle",
    name: "Blush Pink Study Bottle",
    category: "bottles-lifestyle",
    subcategory: "water-bottles",
    price: 28,
    salePrice: 22,
    image: bottle,
    colors: [blush, cream, mint, lilac],
    rating: 4.6,
    reviews: 189,
    badges: ["sale"],
    label: "500 ml, leak-proof",
    description:
      "A soft-touch matte bottle with a sakura print, made to sit prettily on your desk during long study sessions. Fits in most bag pockets.",
    material: "Stainless steel + silicone",
    size: "500 ml",
  },
  {
    id: "seoul-doodle-notebook",
    name: "Seoul Doodle Notebook",
    category: "paper-goods",
    subcategory: "notebooks",
    price: 12,
    image: notebook,
    colors: [blush, cream],
    rating: 4.7,
    reviews: 156,
    badges: ["bestseller"],
    label: "A5 spiral, 120 pages",
    description:
      "Thick dot-grid pages with a sturdy pastel cover doodled in Seoul-inspired icons. Elastic closure and a satin ribbon keep your spreads safe.",
    material: "FSC paper, PU cover",
    size: "A5 (14.8 x 21 cm)",
  },
  {
    id: "strawberry-milk-washi-tape",
    name: "Strawberry Milk Washi Tape Set",
    category: "stickers-deco",
    subcategory: "washi-tapes",
    price: 9,
    image: washi,
    colors: [cherry, blush, cream],
    rating: 4.8,
    reviews: 271,
    badges: ["new"],
    label: "Set of 4 rolls",
    description:
      "Four rolls of dreamy strawberry-milk washi in tonal pinks. Tear-friendly, layer-friendly, and perfect for scrapbooks and gift wrap.",
    material: "Japanese washi paper",
    size: "15 mm x 5 m",
  },
  {
    id: "mini-heart-pencil-pouch",
    name: "Mini Heart Pencil Pouch",
    category: "bags-pouches",
    subcategory: "pencil-cases",
    price: 18,
    salePrice: 15,
    image: pouch,
    colors: [blush, cherry, cream],
    rating: 4.5,
    reviews: 98,
    badges: ["sale"],
    label: "Heart-shaped pouch",
    description:
      "A puffy heart-shaped pouch with a gold zipper pull. Big enough for pens, lip balms, and small treasures — small enough to be cute anywhere.",
    material: "Vegan leather",
    size: "16 x 14 cm",
  },
  {
    id: "dreamy-planner-sticker-kit",
    name: "Dreamy Planner Sticker Kit",
    category: "stickers-deco",
    subcategory: "planner-stickers",
    price: 11,
    image: planner,
    colors: [cherry, blush, mint, lilac],
    rating: 4.9,
    reviews: 402,
    badges: ["bestseller"],
    label: "10 sticker sheets",
    description:
      "A full month of dreamy planner deco: icons, functional labels, headers, and washi-strip stickers all in one kit.",
    material: "Matte sticker paper",
    size: "10 x A5 sheets",
  },
  {
    id: "peach-cream-journal",
    name: "Peach Cream Journal",
    category: "paper-goods",
    subcategory: "journals",
    price: 24,
    image: journal,
    colors: [peach, cream, blush],
    rating: 4.8,
    reviews: 143,
    badges: ["new"],
    label: "Hardcover, 200 pages",
    description:
      "A soft peach hardcover journal with gold accents, a magnetic clasp, and cotton-feel pages. Made for slow mornings and long thoughts.",
    material: "Vegan leather, cotton paper",
    size: "A5",
  },
  {
    id: "soft-bear-highlighter-set",
    name: "Soft Bear Highlighter Set",
    category: "writing-tools",
    subcategory: "highlighters",
    price: 13,
    image: highlighter,
    colors: [blush, cream, peach],
    rating: 4.6,
    reviews: 176,
    badges: ["new"],
    label: "Set of 4 highlighters",
    description:
      "Tiny bear-shaped highlighters with mild pastel ink that won't shout on your page. Chisel tip for both broad strokes and detail work.",
    material: "ABS plastic",
    size: "10 cm each",
  },
  {
    id: "pink-sakura-memo-pad",
    name: "Pink Sakura Memo Pad",
    category: "paper-goods",
    subcategory: "memo-pads",
    price: 7,
    image: memo,
    colors: [blush, cream],
    rating: 4.7,
    reviews: 88,
    badges: [],
    label: "100 sheets",
    description:
      "A soft sakura-illustrated memo pad for love notes, to-do lists, and little kindnesses left on someone's desk.",
    material: "Recycled paper",
    size: "10 x 12 cm",
  },
  {
    id: "cozy-desk-deco-kit",
    name: "Cozy Desk Deco Kit",
    category: "bottles-lifestyle",
    subcategory: "desk-accessories",
    price: 34,
    salePrice: 28,
    image: desk,
    colors: [blush, cream],
    rating: 4.8,
    reviews: 122,
    badges: ["sale", "bestseller"],
    label: "8-piece desk set",
    description:
      "Everything you need to soften your desk: a mini memo tray, heart clips, blush erasers, and a matching pen — all in one gift-ready box.",
    material: "Mixed",
    size: "Various",
  },
];

export const getProduct = (id: string) => products.find((p) => p.id === id);
export const getCategory = (slug: string) => categories.find((c) => c.slug === slug);
