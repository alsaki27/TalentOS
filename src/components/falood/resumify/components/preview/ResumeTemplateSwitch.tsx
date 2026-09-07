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
  switch (data.template) {
    case 'tech-sidebar':
      return <TechSidebarTemplate data={data} />;
    case 'business-professional':
      return <BusinessProfessionalTemplate data={data} variant={1} />;
    case 'business-professional-2':
      return <BusinessProfessionalTemplate data={data} variant={2} />;
    case 'business-professional-3':
      return <BusinessProfessionalTemplate data={data} variant={3} />;
    case 'business-professional-4':
      return <BusinessProfessionalTemplate data={data} variant={4} />;
    case 'modern-minimal':
      return <ModernMinimalTemplate data={data} />;
    case 'elegant-timeline':
      return <ElegantTimelineTemplate data={data} />;
    case 'creative-modern':
      return <CreativeModernTemplate data={data} />;
    case 'bjet-professional':
      return <BJetProfessionalTemplate data={data} />;
    default:
      return <TechSidebarTemplate data={data} />;
  }
};
