import React, { useState } from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Plus, Trash2, X } from 'lucide-react';
import { SkillCategory } from '@/components/falood/resumify/types/resume';

export const SkillsForm: React.FC = () => {
  const { state, updateSkills } = useResume();
  const { skills } = state.resumeData;
  
  const [newSkill, setNewSkill] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');

  const addSimpleSkill = () => {
    if (!newSkill.trim()) return;
    
    const updatedSkills = {
      ...skills,
      simple: [...skills.simple, newSkill.trim()]
    };
    updateSkills(updatedSkills);
    setNewSkill('');
  };

  const removeSimpleSkill = (skillToRemove: string) => {
    const updatedSkills = {
      ...skills,
      simple: skills.simple.filter(skill => skill !== skillToRemove)
    };
    updateSkills(updatedSkills);
  };

  const addCategory = () => {
    if (!newCategoryName.trim() || skills.categorized.length >= 4) return;
    
    const newCategory: SkillCategory = {
      id: Date.now().toString(),
      name: newCategoryName.trim(),
      skills: []
    };
    
    const updatedSkills = {
      ...skills,
      categorized: [...skills.categorized, newCategory]
    };
    updateSkills(updatedSkills);
    setNewCategoryName('');
  };

  const removeCategory = (categoryId: string) => {
    const updatedSkills = {
      ...skills,
      categorized: skills.categorized.filter(cat => cat.id !== categoryId)
    };
    updateSkills(updatedSkills);
  };

  const addSkillToCategory = (categoryId: string, skill: string) => {
    if (!skill.trim()) return;
    
    const updatedSkills = {
      ...skills,
      categorized: skills.categorized.map(category => 
        category.id === categoryId 
          ? { ...category, skills: [...category.skills, skill.trim()] }
          : category
      )
    };
    updateSkills(updatedSkills);
  };

  const removeSkillFromCategory = (categoryId: string, skillToRemove: string) => {
    const updatedSkills = {
      ...skills,
      categorized: skills.categorized.map(category => 
        category.id === categoryId 
          ? { ...category, skills: category.skills.filter(skill => skill !== skillToRemove) }
          : category
      )
    };
    updateSkills(updatedSkills);
  };

  const updateCategoryName = (categoryId: string, newName: string) => {
    const updatedSkills = {
      ...skills,
      categorized: skills.categorized.map(category => 
        category.id === categoryId 
          ? { ...category, name: newName }
          : category
      )
    };
    updateSkills(updatedSkills);
  };

  const handleSkillKeyPress = (e: React.KeyboardEvent<HTMLInputElement>, categoryId?: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      
      if (categoryId) {
        addSkillToCategory(categoryId, input.value);
      } else {
        setNewSkill(input.value);
        addSimpleSkill();
      }
      input.value = '';
    }
  };

  const changeMode = (mode: 'simple' | 'categorized') => {
    updateSkills({ ...skills, mode });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Skills</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode Selection */}
        <div className="space-y-3">
          <Label>Display Mode</Label>
          <RadioGroup
            value={skills.mode}
            onValueChange={(value) => changeMode(value as 'simple' | 'categorized')}
            className="flex flex-col space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="simple" id="simple" />
              <Label htmlFor="simple">Simple List (bullet points)</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="categorized" id="categorized" />
              <Label htmlFor="categorized">Categorized (grouped by type)</Label>
            </div>
          </RadioGroup>
        </div>

        {/* Simple Mode */}
        {skills.mode === 'simple' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Enter a skill and press Enter"
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyPress={(e) => handleSkillKeyPress(e)}
              />
              <Button type="button" onClick={addSimpleSkill} disabled={!newSkill.trim()}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            
            {skills.simple.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {skills.simple.map((skill) => (
                  <Badge key={skill} variant="secondary" className="flex items-center gap-1">
                    {skill}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 ml-1"
                      onClick={() => removeSimpleSkill(skill)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Categorized Mode */}
        {skills.mode === 'categorized' && (
          <div className="space-y-6">
            {/* Add Category */}
            {skills.categorized.length < 4 && (
              <div className="space-y-2">
                <Label>Add New Category</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Category name (e.g., Frontend, Backend, Tools)"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                  />
                  <Button 
                    type="button" 
                    onClick={addCategory} 
                    disabled={!newCategoryName.trim() || skills.categorized.length >= 4}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Maximum 4 categories allowed ({skills.categorized.length}/4 used)
                </p>
              </div>
            )}

            {/* Categories */}
            {skills.categorized.map((category) => (
              <Card key={category.id} className="border-dashed">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Input
                      value={category.name}
                      onChange={(e) => updateCategoryName(category.id, e.target.value)}
                      className="font-medium border-none p-0 h-auto text-base"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => removeCategory(category.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add skill and press Enter"
                      onKeyPress={(e) => handleSkillKeyPress(e, category.id)}
                      disabled={category.skills.length >= 5}
                    />
                  </div>
                  
                  {category.skills.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {category.skills.map((skill) => (
                        <Badge key={skill} variant="outline" className="flex items-center gap-1">
                          {skill}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 ml-1"
                            onClick={() => removeSkillFromCategory(category.id, skill)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  
                  <p className="text-xs text-muted-foreground">
                    {category.skills.length}/5 skills in this category
                  </p>
                </CardContent>
              </Card>
            ))}
            
            {skills.categorized.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p>No skill categories added yet.</p>
                <p className="text-sm">Add a category to get started.</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};