import { ArticlePage, articleMeta, articleParams } from "../../../seo/views";

type P = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export const generateStaticParams = articleParams;
export async function generateMetadata({ params }: P) { return articleMeta("ru", (await params).slug); }
export default async function Page({ params }: P) { return <ArticlePage lang="ru" slug={(await params).slug} />; }
