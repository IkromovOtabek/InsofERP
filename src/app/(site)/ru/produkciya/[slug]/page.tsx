import { ProductPage, productMeta, productParams } from "../../../seo/views";

type P = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export const generateStaticParams = productParams;
export async function generateMetadata({ params }: P) { return productMeta("ru", (await params).slug); }
export default async function Page({ params }: P) { return <ProductPage lang="ru" slug={(await params).slug} />; }
