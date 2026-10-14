import { ArticlesPage, articlesMeta } from "../../seo/views";

export async function generateMetadata() { return articlesMeta("ru"); }
export default function Page() { return <ArticlesPage lang="ru" />; }
