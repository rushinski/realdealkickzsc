import { BrandShowcaseSection } from "@/modules/storefront/presentation/components/home/BrandShowcaseSection";
import { HomeHero } from "@/modules/storefront/presentation/components/home/HomeHero";
import { storefrontHomeShowcaseSections } from "@/modules/storefront/application/storefront-home";

export function HomePageContent() {
  return (
    <div className="bg-brand-page">
      <HomeHero />
      {storefrontHomeShowcaseSections.map((section) => (
        <BrandShowcaseSection key={section.key} heading={section.heading} />
      ))}
    </div>
  );
}
