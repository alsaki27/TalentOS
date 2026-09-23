import React from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Education } from '@/components/falood/resumify/types/resume';

export const EducationForm: React.FC = () => {
  const { state, updateEducation } = useResume();
  const { education } = state.resumeData;

  const addEducation = () => {
    if (education.length >= 3) {
      return; // Max 3 entries
    }
    
    const newEdu: Education = {
      id: Date.now().toString(),
      degree: '',
      institution: '',
      location: '',
      graduationYear: '',
      gpa: '',
      honors: ''
    };
    updateEducation([...education, newEdu]);
  };

  const removeEducation = (id: string) => {
    updateEducation(education.filter(edu => edu.id !== id));
  };

  const updateEdu = (id: string, field: keyof Education, value: string) => {
    updateEducation(education.map(edu => 
      edu.id === id ? { ...edu, [field]: value } : edu
    ));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Education
          {education.length < 3 && (
            <Button onClick={addEducation} size="sm" variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              Add Education
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {education.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No education added yet.</p>
            <p className="text-sm">Click "Add Education" to get started.</p>
          </div>
        ) : (
          education.map((edu, index) => (
            <Card key={edu.id} className="relative">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-muted-foreground cursor-move" />
                    <span className="text-sm font-medium">Education {index + 1}</span>
                  </div>
                  <Button
                    onClick={() => removeEducation(edu.id)}
                    size="sm"
                    variant="destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Degree *</Label>
                    <Input
                      placeholder="Bachelor of Science in Computer Science"
                      value={edu.degree}
                      onChange={(e) => updateEdu(edu.id, 'degree', e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Institution *</Label>
                    <Input
                      placeholder="University Name"
                      value={edu.institution}
                      onChange={(e) => updateEdu(edu.id, 'institution', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Location</Label>
                    <Input
                      placeholder="City, State"
                      value={edu.location}
                      onChange={(e) => updateEdu(edu.id, 'location', e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Graduation Year *</Label>
                    <Input
                      placeholder="2024"
                      value={edu.graduationYear}
                      onChange={(e) => updateEdu(edu.id, 'graduationYear', e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>GPA (Optional)</Label>
                    <Input
                      placeholder="3.8/4.0"
                      value={edu.gpa}
                      onChange={(e) => updateEdu(edu.id, 'gpa', e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Honors/Awards (Optional)</Label>
                  <Input
                    placeholder="Magna Cum Laude, Dean's List, etc."
                    value={edu.honors}
                    onChange={(e) => updateEdu(edu.id, 'honors', e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          ))
        )}
        
        {education.length >= 3 && (
          <p className="text-xs text-muted-foreground text-center">
            Maximum of 3 education entries allowed for optimal resume length.
          </p>
        )}
      </CardContent>
    </Card>
  );
};