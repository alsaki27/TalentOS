import React from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Palette, RotateCcw, Type, Settings } from 'lucide-react';
import { DEFAULT_COLORS } from '@/components/falood/resumify/types/resume';

export const ColorCustomizer: React.FC = () => {
  const { state, updateColors, updateFontSize, updateFontFamily } = useResume();
  const { colors, fontSize, fontFamily } = state.resumeData;

  const updateColor = (colorKey: keyof typeof colors, value: string) => {
    updateColors({ ...colors, [colorKey]: value });
  };

  const resetToDefaults = () => {
    updateColors(DEFAULT_COLORS);
  };

  const colorPresets = [
    {
      name: 'Professional Blue',
      colors: {
        primary: '#3b82f6',
        secondary: '#6b7280',
        accent: '#10b981',
        text: '#1f2937',
        background: '#ffffff'
      }
    },
    {
      name: 'Modern Teal',
      colors: {
        primary: '#06b6d4',
        secondary: '#64748b',
        accent: '#8b5cf6',
        text: '#1e293b',
        background: '#ffffff'
      }
    },
    {
      name: 'Creative Orange',
      colors: {
        primary: '#f59e0b',
        secondary: '#6b7280',
        accent: '#ef4444',
        text: '#1f2937',
        background: '#ffffff'
      }
    },
    {
      name: 'Elegant Purple',
      colors: {
        primary: '#8b5cf6',
        secondary: '#6b7280',
        accent: '#ec4899',
        text: '#1f2937',
        background: '#ffffff'
      }
    },
    {
      name: 'Corporate Gray',
      colors: {
        primary: '#374151',
        secondary: '#6b7280',
        accent: '#3b82f6',
        text: '#1f2937',
        background: '#ffffff'
      }
    },
    {
      name: 'Tech Green',
      colors: {
        primary: '#10b981',
        secondary: '#6b7280',
        accent: '#3b82f6',
        text: '#1f2937',
        background: '#ffffff'
      }
    }
  ];

  const applyPreset = (preset: typeof colorPresets[0]) => {
    updateColors(preset.colors);
  };

  const fontOptions = [
    { value: 'Inter', label: 'Inter' },
    { value: 'Poppins', label: 'Poppins' },
    { value: 'Lato', label: 'Lato' },
    { value: 'Source Sans Pro', label: 'Source Sans Pro' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Times New Roman', label: 'Times New Roman' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Helvetica', label: 'Helvetica' }
  ];

  const fontSizeOptions = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium (Default)' },
    { value: 'large', label: 'Large' }
  ];

  return (
    <div className="space-y-6">
      {/* Typography Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Type className="w-5 h-5" />
            Typography Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Font Family</Label>
              <Select 
                value={fontFamily || 'Inter'} 
                onValueChange={(value) => updateFontFamily(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select font" />
                </SelectTrigger>
                <SelectContent>
                  {fontOptions.map((font) => (
                    <SelectItem key={font.value} value={font.value}>
                      {font.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Font Size</Label>
              <Select 
                value={fontSize || 'medium'} 
                onValueChange={(value) => updateFontSize(value as 'small' | 'medium' | 'large')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent>
                  {fontSizeOptions.map((size) => (
                    <SelectItem key={size.value} value={size.value}>
                      {size.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Color Customization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5" />
            Color Customization
          </CardTitle>
        </CardHeader>
      <CardContent className="space-y-6">
        {/* Color Presets */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Color Presets</Label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {colorPresets.map((preset) => (
              <Button
                key={preset.name}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(preset)}
                className="h-auto p-3 flex flex-col items-center gap-2"
              >
                <div className="flex gap-1">
                  <div
                    className="w-4 h-4 rounded-full border border-border"
                    style={{ backgroundColor: preset.colors.primary }}
                  />
                  <div
                    className="w-4 h-4 rounded-full border border-border"
                    style={{ backgroundColor: preset.colors.secondary }}
                  />
                  <div
                    className="w-4 h-4 rounded-full border border-border"
                    style={{ backgroundColor: preset.colors.accent }}
                  />
                </div>
                <span className="text-xs">{preset.name}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* Custom Colors */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Custom Colors</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={resetToDefaults}
              className="flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="primary-color">Primary Color</Label>
              <div className="flex gap-2">
                <Input
                  id="primary-color"
                  type="color"
                  value={colors.primary}
                  onChange={(e) => updateColor('primary', e.target.value)}
                  className="w-12 h-10 p-1 border-2"
                />
                <Input
                  value={colors.primary}
                  onChange={(e) => updateColor('primary', e.target.value)}
                  placeholder="#3b82f6"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Used for headers and important elements
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="secondary-color">Secondary Color</Label>
              <div className="flex gap-2">
                <Input
                  id="secondary-color"
                  type="color"
                  value={colors.secondary}
                  onChange={(e) => updateColor('secondary', e.target.value)}
                  className="w-12 h-10 p-1 border-2"
                />
                <Input
                  value={colors.secondary}
                  onChange={(e) => updateColor('secondary', e.target.value)}
                  placeholder="#6b7280"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Used for subheadings and secondary text
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="accent-color">Accent Color</Label>
              <div className="flex gap-2">
                <Input
                  id="accent-color"
                  type="color"
                  value={colors.accent}
                  onChange={(e) => updateColor('accent', e.target.value)}
                  className="w-12 h-10 p-1 border-2"
                />
                <Input
                  value={colors.accent}
                  onChange={(e) => updateColor('accent', e.target.value)}
                  placeholder="#10b981"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Used for skill tags and highlights
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="text-color">Text Color</Label>
              <div className="flex gap-2">
                <Input
                  id="text-color"
                  type="color"
                  value={colors.text}
                  onChange={(e) => updateColor('text', e.target.value)}
                  className="w-12 h-10 p-1 border-2"
                />
                <Input
                  value={colors.text}
                  onChange={(e) => updateColor('text', e.target.value)}
                  placeholder="#1f2937"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Main body text color
              </p>
            </div>
          </div>
        </div>

        {/* Color Preview */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Preview</Label>
          <div 
            className="p-4 rounded-lg border-2"
            style={{ backgroundColor: colors.background, color: colors.text }}
          >
            <h3 
              className="font-bold text-lg mb-2"
              style={{ color: colors.primary }}
            >
              Sample Header
            </h3>
            <p 
              className="text-sm mb-2"
              style={{ color: colors.secondary }}
            >
              Sample subheading text
            </p>
            <p className="text-sm mb-3">
              This is sample body text to show how your chosen colors will look on the resume.
            </p>
            <div className="flex gap-2">
              <span 
                className="px-2 py-1 text-xs rounded"
                style={{ 
                  backgroundColor: colors.accent + '20', 
                  color: colors.accent,
                  border: `1px solid ${colors.accent}40`
                }}
              >
                Sample Skill
              </span>
              <span 
                className="px-2 py-1 text-xs rounded"
                style={{ 
                  backgroundColor: colors.primary + '20', 
                  color: colors.primary,
                  border: `1px solid ${colors.primary}40`
                }}
              >
                Another Tag
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-muted rounded-lg">
          <h4 className="font-medium mb-2">Color Tips</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Use high contrast colors for better readability</li>
            <li>• Stick to 2-3 main colors for a professional look</li>
            <li>• Consider your industry when choosing colors</li>
            <li>• Test your colors in both digital and print formats</li>
          </ul>
        </div>
      </CardContent>
      </Card>
    </div>
  );
};