import React, { useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ResumeFormProps {
  activePanel: 'form' | 'customize' | 'settings';
}

export const ResumeForm: React.FC<ResumeFormProps> = ({ activePanel }) => {
  const [activeTab, setActiveTab] = useState('personal');

  const renderPanel = () => {
    switch (activePanel) {
      case 'form':
        return (
          <div className="p-6 h-full">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
              <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1 mb-4">
                <TabsTrigger value="personal" className="text-xs px-2 py-2">Personal</TabsTrigger>
                <TabsTrigger value="experience" className="text-xs px-1 py-2">Work & Projects</TabsTrigger>
                <TabsTrigger value="education" className="text-xs px-1 py-2">Education & Skills</TabsTrigger>
                <TabsTrigger value="custom" className="text-xs px-2 py-2">Custom</TabsTrigger>
              </TabsList>
              
              <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <TabsContent value="personal" className="space-y-6 mt-0">
                    <PersonalInfoForm />
                    <SummaryForm />
                  </TabsContent>
                  
                  <TabsContent value="experience" className="space-y-6 mt-0">
                    <ExperienceForm />
                    <ProjectsForm />
                  </TabsContent>
                  
                  <TabsContent value="education" className="space-y-6 mt-0">
                    <EducationForm />
                    <SkillsForm />
                  </TabsContent>
                  
                  <TabsContent value="custom" className="space-y-6 mt-0">
                    <CustomSectionsForm />
                  </TabsContent>
                </ScrollArea>
              </div>
            </Tabs>
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