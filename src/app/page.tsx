import { publicRead } from "@/lib/public-cache";
import { getConsultantPortrait } from "@/lib/portraits";
import { getManagedPageContent } from "@/lib/managed-pages";
import { canPreviewPages } from "@/lib/managed-pages";
import PagePreviewBanner from "@/components/admin/PagePreviewBanner";
import { pageMetadata } from "@/lib/seo";
import { prisma } from "@/lib/prisma";
import { isSiteSettingsDatabaseReady } from "@/lib/site-settings";
import Hero from '@/components/home/Hero';
import AudiencePaths from '@/components/home/AudiencePaths';
import ServicePillars from '@/components/home/ServicePillars';
import Process from '@/components/home/Process';
import FeaturedProject from '@/components/home/FeaturedProject';
import EngagementOverview from '@/components/home/EngagementOverview';
import Differentiator from '@/components/home/Differentiator';
import FAQ from '@/components/home/FAQ';
import FinalCTA from '@/components/home/FinalCTA';
import { getHomePageContent } from '@/lib/homepage';
import { getPublicBlogPosts } from '@/lib/content';
import { getCaseStudies } from '@/lib/case-studies';
import { getTestimonials } from '@/lib/site-settings';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export default async function HomePage() {
  const [content, posts, studies, testimonials, about] = await Promise.all([getHomePageContent(), getPublicBlogPosts(), getCaseStudies(), getTestimonials(), getManagedPageContent("about")]);
  const featured = studies.find((study) => study.slug === content.featured.slug);
  const preview = await canPreviewPages();
  const imageUrl = (url: string) => preview && url.startsWith("/api/media/") ? url.replace("/api/media/", "/api/admin/media/") : url;
  const selectedPortrait = getConsultantPortrait(about, "hero");
  const portrait = { ...selectedPortrait, url: imageUrl(selectedPortrait.url) };
  const featuredUrl = featured?.images[0];
  const mediaId = featuredUrl?.startsWith("/api/media/") ? featuredUrl.split("/").pop() : undefined;
  const media = mediaId ? await publicRead(`media-alt:${mediaId}`, () => prisma.mediaAsset.findUnique({ where: { id: mediaId }, select: { altText: true } })).catch(() => null) : null;
  const projectImage = featuredUrl ? { url: imageUrl(featuredUrl), alt: media?.altText || `${featured?.title} project screenshot` } : undefined;
  const sections = {
    hero: <Hero content={content.hero} portrait={portrait} />,
    audiences: <AudiencePaths content={content.audiences} />,
    pillars: <ServicePillars content={content.pillars} />,
    problems: <section className="section-shell"><div className="section-inner grid gap-8 lg:grid-cols-[.7fr_1fr]"><h2 className="section-title">{content.problems.title}</h2><ol className="problem-list">{content.problems.items.map((item) => <li className="problem-item" key={item}><p className="text-slate-muted">{item}</p></li>)}</ol></div></section>,
    process: <Process content={content.process} />,
    featured: featured ? <FeaturedProject content={{ ...content.featured, title: featured.title, description: featured.summary }} image={projectImage} /> : null,
    engagements: <EngagementOverview content={content.engagements} />,
    differentiator: <><Differentiator content={content.differentiator} />{testimonials.some((item) => item.isPublished) && <section aria-label="Client feedback" className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-6">{testimonials.filter((item) => item.isPublished).map((item) => <blockquote key={item.id} className="glass-card p-8"><p>{item.quote}</p><footer className="mt-4 text-slate-muted">{item.name} · {item.role}, {item.company}</footer></blockquote>)}</section>}</>,
    insights: posts.length ? <section className="section-shell section-inner"><h2 className="section-title mb-10">{content.insights.title}</h2><div className="grid md:grid-cols-3 gap-6">{posts.slice(0, 3).map((post) => <Link href={`/blog/${post.slug}`} key={post.slug} className="glass-card p-6"><p className="text-electric text-sm mb-3">{post.category}</p><h3 className="text-xl font-bold mb-4">{post.title}</h3><p className="text-slate-muted">{post.excerpt}</p></Link>)}</div></section> : null,
    faq: <FAQ content={content.faq} />,
    finalCta: <FinalCTA content={content.finalCta} />,
  };
  return <main className="min-h-screen bg-midnight text-platinum"><PagePreviewBanner slug="home" />{content.sections.map((key) => <div key={key}>{sections[key]}</div>)}</main>;
}

export async function generateMetadata() {
  const content = await getHomePageContent();
  const record = isSiteSettingsDatabaseReady() ? await publicRead("homepage-seo", () => prisma.siteSetting.findUnique({ where: { key: "homepage.seo" } })).catch(() => null) : null;
  const draft = isSiteSettingsDatabaseReady() && await canPreviewPages() ? await prisma.page.findUnique({ where: { slug: "home" } }).catch(() => null) : null;
  const seo = draft ? { title: draft.metaTitle ?? undefined, description: draft.metaDescription ?? undefined } : record?.value as { title?: string; description?: string } | undefined;
  return pageMetadata(seo?.title || "Your Technology Partner", seo?.description || content.hero.subheadline, "/");
}
