import { ArticlesPage, articlesMeta } from "../seo/views";

export async function generateMetadata() { return articlesMeta("uz"); }
export default function Page() { return <ArticlesPage lang="uz" />; }
