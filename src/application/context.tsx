import { createContext, useContext } from 'react';
import { createWebRepositories } from '../persistence';
import { createPdvApplication } from './createPdvApplication';
export const webApplication = createPdvApplication(createWebRepositories());
export const ApplicationContext = createContext(webApplication);
export const usePdvApplication = () => useContext(ApplicationContext);
