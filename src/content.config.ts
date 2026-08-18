import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  loader: glob({
    base: "./src/content/blog",
    pattern: "**/*.{md,mdx}",
    generateId: ({ entry }) => {
      return (
        entry
          // Strips leading "YYYY-MM-DD_" from the filename
          .replace(/^\d{4}-\d{2}-\d{2}_/, "")
          .replace(/index\.(md|mdx)$/, "")
          .replace(/\.(md|mdx)$/, "")
      );
    },
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      heroImage: z.optional(image()),
    }),
});

export const collections = { blog };
