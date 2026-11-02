import React from 'react';
import { ResumeData } from '@/components/falood/resumify/types/resume';
import { TechSidebarTemplate } from './templates/TechSidebarTemplate';
import { BusinessProfessionalTemplate } from './templates/BusinessProfessionalTemplate';
import { ModernMinimalTemplate } from './templates/ModernMinimalTemplate';
import { ElegantTimelineTemplate } from './templates/ElegantTimelineTemplate';
import { CreativeModernTemplate } from './templates/CreativeModernTemplate';
import { BJetProfessionalTemplate } from './templates/BJetProfessionalTemplate';

// The single source of truth for "which template renders this resume".
// Extracted from ResumePreview so the candidate portal renders a tailored
// resume through exactly the same templates the studio does - if a template
// is added or its mapping changes, both surfaces pick it up from here rather
// than drifting apart behind two copies of the same switch.
export const ResumeTemplateSwitch: React.FC<{ data: ResumeData }> = ({ data }) => {
  let template: React.ReactNode;
  switch (data.template) {
    case 'tech-sidebar':
      template = <TechSidebarTemplate data={data} />;
      break;
    case 'business-professional':
      template = <BusinessProfessionalTemplate data={data} variant={1} />;
      break;
    case 'business-professional-2':
      template = <BusinessProfessionalTemplate data={data} variant={2} />;
      break;
    case 'business-professional-3':
      template = <BusinessProfessionalTemplate data={data} variant={3} />;
      break;
    case 'business-professional-4':
      template = <BusinessProfessionalTemplate data={data} variant={4} />;
      break;
    case 'modern-minimal':
      template = <ModernMinimalTemplate data={data} />;
      break;
    case 'elegant-timeline':
      template = <ElegantTimelineTemplate data={data} />;
      break;
    case 'creative-modern':
      template = <CreativeModernTemplate data={data} />;
      break;
    case 'bjet-professional':
      template = <BJetProfessionalTemplate data={data} />;
      break;
    default:
      template = <TechSidebarTemplate data={data} />;
  }

  return (
    <>
      <style>{`
        .resume-template h3.mb-2 { margin-bottom: calc(0.5rem + var(--resume-title-spacing, 0rem)) !important; }
        .resume-template h3.mb-3 { margin-bottom: calc(0.75rem + var(--resume-title-spacing, 0rem)) !important; }
        .resume-template h3.mb-4 { margin-bottom: calc(1rem + var(--resume-title-spacing, 0rem)) !important; }
        .resume-template-bjet h2.mb-2 { margin-bottom: calc(0.5rem + var(--resume-title-spacing, 0rem)) !important; }
      `}</style>
      {template}
    </>
  );
};
