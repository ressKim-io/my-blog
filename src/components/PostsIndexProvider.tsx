'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Track, PostType } from '@/lib/posts';

export interface PostMeta {
  slug: string;
  track: Track;
  title: string;
  excerpt?: string;
  date: string;
  type?: PostType;
  category: string;
  readingTime: number;
}

const PostsIndexCtx = createContext<Map<string, PostMeta>>(new Map());

export function PostsIndexProvider({ posts, children }: { posts: PostMeta[]; children: ReactNode }) {
  const map = useMemo(() => {
    const m = new Map<string, PostMeta>();
    posts.forEach((p) => m.set(p.slug, p));
    return m;
  }, [posts]);
  return <PostsIndexCtx.Provider value={map}>{children}</PostsIndexCtx.Provider>;
}

export function usePostMeta(slug: string | undefined): PostMeta | undefined {
  const map = useContext(PostsIndexCtx);
  if (!slug) return undefined;
  return map.get(slug);
}
