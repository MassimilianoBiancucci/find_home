/** Colour of each zone target set (zone.yaml target_sets): heatmap legend, 3D pins, house walks and their paths. */
export const SET_COLOURS: Record<string, string> = {
  rail: '#0089ca', bus: '#d71d24', ferry: '#00a5ac', grocery: '#2f9e44', pharmacy: '#1c7ed6', gym: '#e8590c', park: '#5c940d', vet: '#ae3ec9',
};
export const setColour = (s: string) => SET_COLOURS[s] ?? '#8a8aa0';
