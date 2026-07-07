import React from 'react';
import { PersonalInfoForm } from './sections/PersonalInfoForm';
import { SummaryForm } from './sections/SummaryForm';
import { ExperienceForm } from './sections/ExperienceForm';
import { EducationForm } from './sections/EducationForm';
import { ProjectsForm } from './sections/ProjectsForm';
import { SkillsForm } from './sections/SkillsForm';
import { CustomSectionsForm } from './sections/CustomSectionsForm';
import { TemplateSelector } from './sections/TemplateSelector';
import { ColorCustomizer } from './sections/ColorCustomizer';
import { SectionManager } from './sections/SectionManager';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ResumeFormProps {
  activePanel: 'form' | 'customize' | 'settings';
}

export const ResumeForm: React.FC<ResumeFormProps> = ({ activePanel }) => {
  const renderPanel = () => {
    switch (activePanel) {
      case 'form':
        return (
          <div className="space-y-6 p-6">
            <PersonalInfoForm />
            <SummaryForm />
            <ExperienceForm />
            <ProjectsForm />
            <EducationForm />
            <SkillsForm />
            <CustomSectionsForm />
          </div>
        );
      
      case 'customize':
        return (
          <div className="space-y-8 p-6">
            <TemplateSelector />
            <ColorCustomizer />
          </div>
        );
      
      case 'settings':
        return (
          <div className="space-y-8 p-6">
            <SectionManager />
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <ScrollArea className="h-full">
      {renderPanel()}
    </ScrollArea>
  );
};
