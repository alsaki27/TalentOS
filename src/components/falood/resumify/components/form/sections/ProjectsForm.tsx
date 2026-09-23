import React from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, GripVertical, X } from 'lucide-react';
import { Project } from '@/components/falood/resumify/types/resume';

export const ProjectsForm: React.FC = () => {
  const { state, updateProjects } = useResume();
  const { projects } = state.resumeData;

  const addProject = () => {
    const newProject: Project = {
      id: Date.now().toString(),
      title: '',
      description: '',
      technologies: [],
      liveUrl: '',
      githubUrl: '',
      startDate: '',
      endDate: ''
    };
    updateProjects([...projects, newProject]);
  };

  const removeProject = (id: string) => {
    updateProjects(projects.filter(project => project.id !== id));
  };

  const updateProject = (id: string, field: keyof Project, value: any) => {
    updateProjects(projects.map(project => 
      project.id === id ? { ...project, [field]: value } : project
    ));
  };

  const addTechnology = (id: string, tech: string) => {
    if (!tech.trim()) return;
    
    const project = projects.find(p => p.id === id);
    if (project && !project.technologies.includes(tech.trim())) {
      updateProject(id, 'technologies', [...project.technologies, tech.trim()]);
    }
  };

  const removeTechnology = (id: string, tech: string) => {
    const project = projects.find(p => p.id === id);
    if (project) {
      updateProject(id, 'technologies', project.technologies.filter(t => t !== tech));
    }
  };

  const handleTechKeyPress = (e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      addTechnology(id, input.value);
      input.value = '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Projects
          <Button onClick={addProject} size="sm" variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            Add Project
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {projects.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No projects added yet.</p>
            <p className="text-sm">Click "Add Project" to showcase your work.</p>
          </div>
        ) : (
          projects.map((project, index) => (
            <Card key={project.id} className="relative">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-muted-foreground cursor-move" />
                    <span className="text-sm font-medium">Project {index + 1}</span>
                  </div>
                  <Button
                    onClick={() => removeProject(project.id)}
                    size="sm"
                    variant="destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Project Title *</Label>
                  <Input
                    placeholder="E-commerce Platform"
                    value={project.title}
                    onChange={(e) => updateProject(project.id, 'title', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Description *</Label>
                  <Textarea
                    placeholder="Describe your project, its purpose, and key features..."
                    value={project.description}
                    onChange={(e) => updateProject(project.id, 'description', e.target.value)}
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input
                      type="month"
                      value={project.startDate}
                      onChange={(e) => updateProject(project.id, 'startDate', e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input
                      type="month"
                      value={project.endDate}
                      onChange={(e) => updateProject(project.id, 'endDate', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Live URL</Label>
                    <Input
                      placeholder="https://project-demo.com"
                      value={project.liveUrl}
                      onChange={(e) => updateProject(project.id, 'liveUrl', e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>GitHub URL</Label>
                    <Input
                      placeholder="https://github.com/username/project"
                      value={project.githubUrl}
                      onChange={(e) => updateProject(project.id, 'githubUrl', e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Technologies Used</Label>
                  <Input
                    placeholder="Type a technology and press Enter"
                    onKeyPress={(e) => handleTechKeyPress(e, project.id)}
                  />
                  
                  {project.technologies.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {project.technologies.map((tech) => (
                        <Badge key={tech} variant="secondary" className="flex items-center gap-1">
                          {tech}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 ml-1"
                            onClick={() => removeTechnology(project.id, tech)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  
                  <p className="text-xs text-muted-foreground">
                    Press Enter to add each technology (e.g., React, Node.js, MongoDB)
                  </p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </CardContent>
    </Card>
  );
};