import React from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { GripVertical, Eye, EyeOff, Settings } from 'lucide-react';

export const SectionManager: React.FC = () => {
  const { state, updateSections, updatePageFormat } = useResume();
  const { sections, pageFormat } = state.resumeData;

  const toggleSectionVisibility = (sectionId: string) => {
    const updatedSections = sections.map(section =>
      section.id === sectionId 
        ? { ...section, visible: !section.visible }
        : section
    );
    updateSections(updatedSections);
  };

  const reorderSections = (dragIndex: number, hoverIndex: number) => {
    const updatedSections = [...sections];
    const draggedSection = updatedSections[dragIndex];
    updatedSections.splice(dragIndex, 1);
    updatedSections.splice(hoverIndex, 0, draggedSection);
    
    // Update order values
    const reorderedSections = updatedSections.map((section, index) => ({
      ...section,
      order: index + 1
    }));
    
    updateSections(reorderedSections);
  };

  const moveSection = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index > 0) {
      reorderSections(index, index - 1);
    } else if (direction === 'down' && index < sections.length - 1) {
      reorderSections(index, index + 1);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Format Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Page Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Label>Page Format</Label>
            <RadioGroup
              value={pageFormat}
              onValueChange={(value) => updatePageFormat(value as 'letter' | 'a4')}
              className="flex flex-col space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="letter" id="letter" />
                <Label htmlFor="letter">US Letter (8.5" × 11")</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="a4" id="a4" />
                <Label htmlFor="a4">A4 (210mm × 297mm)</Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              Choose the page format that matches your region's standard.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Section Management */}
      <Card>
        <CardHeader>
          <CardTitle>Section Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Section Visibility & Order</Label>
            <p className="text-sm text-muted-foreground">
              Toggle sections on/off and reorder them as needed. Drag sections to reorder.
            </p>
          </div>

          <div className="space-y-2">
            {sections
              .sort((a, b) => a.order - b.order)
              .map((section, index) => (
                <div
                  key={section.id}
                  className="flex items-center justify-between p-3 border rounded-lg bg-card"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => moveSection(index, 'up')}
                        disabled={index === 0}
                        className="h-6 w-6 p-0"
                      >
                        ↑
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => moveSection(index, 'down')}
                        disabled={index === sections.length - 1}
                        className="h-6 w-6 p-0"
                      >
                        ↓
                      </Button>
                    </div>
                    
                    <GripVertical className="w-4 h-4 text-muted-foreground cursor-move" />
                    
                    <div className="flex items-center gap-2">
                      {section.visible ? (
                        <Eye className="w-4 h-4 text-primary" />
                      ) : (
                        <EyeOff className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className={`font-medium ${section.visible ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {section.title}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      Order: {section.order}
                    </span>
                    <Switch
                      checked={section.visible}
                      onCheckedChange={() => toggleSectionVisibility(section.id)}
                    />
                  </div>
                </div>
              ))}
          </div>

          <div className="p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-2">Section Tips</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Hidden sections won't appear on your resume but data is preserved</li>
              <li>• Reorder sections based on what's most important for your target role</li>
              <li>• Keep the most relevant sections near the top</li>
              <li>• Experience and skills are typically the most important sections</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};