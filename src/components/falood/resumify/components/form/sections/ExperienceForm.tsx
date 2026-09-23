import React, { useState } from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Experience } from '@/components/falood/resumify/types/resume';

export const ExperienceForm: React.FC = () => {
  const { state, updateExperience } = useResume();
  const { experience } = state.resumeData;
  
  const [editingId, setEditingId] = useState<string | null>(null);

  const addExperience = () => {
    const newExp: Experience = {
      id: Date.now().toString(),
      jobTitle: '',
      company: '',
      location: '',
      startDate: '',
      endDate: '',
      current: false,
      description: '',
      bulletPoints: ['']
    };
    updateExperience([...experience, newExp]);
    setEditingId(newExp.id);
  };

  const removeExperience = (id: string) => {
    updateExperience(experience.filter(exp => exp.id !== id));
  };

  const updateExp = (id: string, field: keyof Experience, value: any) => {
    updateExperience(experience.map(exp => 
      exp.id === id ? { ...exp, [field]: value } : exp
    ));
  };

  const addBulletPoint = (id: string) => {
    const exp = experience.find(e => e.id === id);
    if (exp) {
      updateExp(id, 'bulletPoints', [...exp.bulletPoints, '']);
    }
  };

  const removeBulletPoint = (id: string, index: number) => {
    const exp = experience.find(e => e.id === id);
    if (exp) {
      updateExp(id, 'bulletPoints', exp.bulletPoints.filter((_, i) => i !== index));
    }
  };

  const updateBulletPoint = (id: string, index: number, value: string) => {
    const exp = experience.find(e => e.id === id);
    if (exp) {
      const newBulletPoints = [...exp.bulletPoints];
      newBulletPoints[index] = value;
      updateExp(id, 'bulletPoints', newBulletPoints);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Work Experience
          <Button onClick={addExperience} size="sm" variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            Add Experience
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {experience.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No work experience added yet.</p>
            <p className="text-sm">Click "Add Experience" to get started.</p>
          </div>
        ) : (
          experience.map((exp, index) => (
            <Card key={exp.id} className="relative">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-muted-foreground cursor-move" />
                    <span className="text-sm font-medium">Experience {index + 1}</span>
                  </div>
                  <Button
                    onClick={() => removeExperience(exp.id)}
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
                    <Label>Job Title *</Label>
                    <Input
                      placeholder="Software Engineer"
                      value={exp.jobTitle}
                      onChange={(e) => updateExp(exp.id, 'jobTitle', e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Company *</Label>
                    <Input
                      placeholder="Tech Company Inc."
                      value={exp.company}
                      onChange={(e) => updateExp(exp.id, 'company', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Location</Label>
                    <Input
                      placeholder="New York, NY"
                      value={exp.location}
                      onChange={(e) => updateExp(exp.id, 'location', e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Start Date *</Label>
                    <Input
                      type="month"
                      value={exp.startDate}
                      onChange={(e) => updateExp(exp.id, 'startDate', e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input
                      type="month"
                      value={exp.endDate}
                      onChange={(e) => updateExp(exp.id, 'endDate', e.target.value)}
                      disabled={exp.current}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={`current-${exp.id}`}
                    checked={exp.current}
                    onCheckedChange={(checked) => updateExp(exp.id, 'current', checked)}
                  />
                  <Label htmlFor={`current-${exp.id}`}>Currently working here</Label>
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    placeholder="Brief description of your role and responsibilities..."
                    value={exp.description}
                    onChange={(e) => updateExp(exp.id, 'description', e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Key Achievements (Bullet Points)</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addBulletPoint(exp.id)}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add Point
                    </Button>
                  </div>
                  
                  {exp.bulletPoints.map((point, pointIndex) => (
                    <div key={pointIndex} className="flex items-center gap-2">
                      <span className="text-muted-foreground">•</span>
                      <Input
                        placeholder={`Achievement ${pointIndex + 1}...`}
                        value={point}
                        onChange={(e) => updateBulletPoint(exp.id, pointIndex, e.target.value)}
                      />
                      {exp.bulletPoints.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeBulletPoint(exp.id, pointIndex)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </CardContent>
    </Card>
  );
};