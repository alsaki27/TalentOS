import React from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { CustomSection } from '@/components/falood/resumify/types/resume';

export const CustomSectionsForm: React.FC = () => {
  const { state, updateCustomSections } = useResume();
  const { customSections } = state.resumeData;

  const addCustomSection = () => {
    const newSection: CustomSection = {
      id: Date.now().toString(),
      title: '',
      content: '',
      type: 'paragraph',
      visible: true,
      order: customSections.length,
      placement: 'right'
    };
    updateCustomSections([...customSections, newSection]);
  };

  const removeCustomSection = (id: string) => {
    updateCustomSections(customSections.filter(section => section.id !== id));
  };

  const updateSection = (id: string, field: keyof CustomSection, value: any) => {
    updateCustomSections(customSections.map(section => 
      section.id === id ? { ...section, [field]: value } : section
    ));
  };

  const commonSectionExamples = [
    { title: 'Certifications', type: 'bullets', placeholder: 'List your professional certifications...' },
    { title: 'Awards & Recognition', type: 'bullets', placeholder: 'List your awards and achievements...' },
    { title: 'Languages', type: 'paragraph', placeholder: 'English (Native), Spanish (Conversational), French (Basic)' },
    { title: 'Publications', type: 'bullets', placeholder: 'List your published work...' },
    { title: 'Volunteer Experience', type: 'bullets', placeholder: 'Describe your volunteer activities...' },
    { title: 'Professional Memberships', type: 'bullets', placeholder: 'List professional organizations...' }
  ];

  const addPredefinedSection = (example: typeof commonSectionExamples[0]) => {
    const newSection: CustomSection = {
      id: Date.now().toString(),
      title: example.title,
      content: '',
      type: example.type as 'paragraph' | 'bullets',
      visible: true,
      order: customSections.length,
      placement: 'right'
    };
    updateCustomSections([...customSections, newSection]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Custom Sections
          <Button onClick={addCustomSection} size="sm" variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            Add Section
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Quick Add Common Sections */}
        {customSections.length === 0 && (
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Quick Add Common Sections</Label>
              <p className="text-xs text-muted-foreground mb-3">
                Click to quickly add popular resume sections
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {commonSectionExamples.map((example) => (
                  <Button
                    key={example.title}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addPredefinedSection(example)}
                    className="text-xs h-auto py-2"
                  >
                    {example.title}
                  </Button>
                ))}
              </div>
            </div>
            <div className="border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Or create a custom section using the "Add Section" button above.
              </p>
            </div>
          </div>
        )}

        {/* Custom Sections */}
        {customSections.length > 0 && (
          <div className="space-y-4">
            {customSections.map((section, index) => (
              <Card key={section.id} className="relative">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-4 h-4 text-muted-foreground cursor-move" />
                      <span className="text-sm font-medium">Section {index + 1}</span>
                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={section.visible}
                          onCheckedChange={(checked) => updateSection(section.id, 'visible', checked)}
                        />
                        <Label className="text-xs text-muted-foreground">
                          {section.visible ? 'Visible' : 'Hidden'}
                        </Label>
                      </div>
                    </div>
                    <Button
                      onClick={() => removeCustomSection(section.id)}
                      size="sm"
                      variant="destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Section Title *</Label>
                    <Input
                      placeholder="e.g., Certifications, Awards, Languages"
                      value={section.title}
                      onChange={(e) => updateSection(section.id, 'title', e.target.value)}
                    />
                  </div>

                   <div className="space-y-3">
                     <Label>Content Type</Label>
                     <RadioGroup
                       value={section.type}
                       onValueChange={(value) => updateSection(section.id, 'type', value)}
                       className="flex flex-row space-x-6"
                     >
                       <div className="flex items-center space-x-2">
                         <RadioGroupItem value="paragraph" id={`paragraph-${section.id}`} />
                         <Label htmlFor={`paragraph-${section.id}`} className="text-sm">
                           Paragraph
                         </Label>
                       </div>
                       <div className="flex items-center space-x-2">
                         <RadioGroupItem value="bullets" id={`bullets-${section.id}`} />
                         <Label htmlFor={`bullets-${section.id}`} className="text-sm">
                           Bullet Points
                         </Label>
                       </div>
                     </RadioGroup>
                   </div>

                   <div className="space-y-3">
                     <Label>Column Placement (Two-Column Templates)</Label>
                     <RadioGroup
                       value={section.placement || 'right'}
                       onValueChange={(value) => updateSection(section.id, 'placement', value)}
                       className="flex flex-row space-x-6"
                     >
                       <div className="flex items-center space-x-2">
                         <RadioGroupItem value="left" id={`left-${section.id}`} />
                         <Label htmlFor={`left-${section.id}`} className="text-sm">
                           Left Column
                         </Label>
                       </div>
                       <div className="flex items-center space-x-2">
                         <RadioGroupItem value="right" id={`right-${section.id}`} />
                         <Label htmlFor={`right-${section.id}`} className="text-sm">
                           Right Column
                         </Label>
                       </div>
                     </RadioGroup>
                     <p className="text-xs text-muted-foreground">
                       This setting only applies to two-column resume templates.
                     </p>
                   </div>

                  <div className="space-y-2">
                    <Label>Content *</Label>
                    <Textarea
                      placeholder={
                        section.type === 'paragraph' 
                          ? "Write a paragraph describing this section..."
                          : "Write each bullet point on a new line:\n• First achievement or item\n• Second achievement or item\n• Third achievement or item"
                      }
                      value={section.content}
                      onChange={(e) => updateSection(section.id, 'content', e.target.value)}
                      rows={section.type === 'bullets' ? 6 : 4}
                    />
                    <p className="text-xs text-muted-foreground">
                      {section.type === 'bullets' 
                        ? "For bullet points, write each item on a new line. You can use • or - to start each point."
                        : "Write a clear, concise paragraph about this section."
                      }
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {customSections.length === 0 && (
          <div className="text-center py-8 text-muted-foreground border-t">
            <p>No custom sections added yet.</p>
            <p className="text-sm">Add sections like certifications, awards, or languages to enhance your resume.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};